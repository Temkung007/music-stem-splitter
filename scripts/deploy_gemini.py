"""Guarded backend-only Gemini activation on the existing STEMORA VPS."""

import argparse
import fcntl
import json
import os
import shutil
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen

parser = argparse.ArgumentParser()
parser.add_argument("--expected-host", required=True)
args = parser.parse_args()
assert socket.gethostname() == args.expected_host
assert os.environ["SSH_CONNECTION"].split()[2] == "143.198.204.118"
root = Path(__file__).resolve().parents[1]
assert root == Path("/var/www/stemora")
os.umask(0o077)
logs = root / "deploy-logs/gemini-20261029"
logs.mkdir(parents=True, exist_ok=True)
lock = (logs / "lock").open("w")
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
compose = [
    "docker",
    "compose",
    "-f",
    "compose.yml",
    "-f",
    "compose.nginx.yml",
    "--profile",
    "ai",
]


def run(command, capture=False):
    return subprocess.run(
        command,
        cwd=root,
        check=True,
        text=True,
        stdout=subprocess.PIPE if capture else None,
    ).stdout


def phase(name, **extra):
    (logs / "state.json").write_text(
        json.dumps(
            {
                "phase": name,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                **extra,
            },
            indent=2,
        )
        + "\n"
    )
    print("PHASE:", name, flush=True)


def wait_healthy():
    deadline = time.monotonic() + 150
    while time.monotonic() < deadline:
        health = run(
            [
                "docker",
                "inspect",
                "--format",
                "{{.State.Health.Status}}",
                "stemora-backend-1",
            ],
            True,
        )
        if health.strip() == "healthy":
            return
        time.sleep(2)
    raise RuntimeError("Backend did not become healthy")


settings = root / ".env"
before = settings.read_bytes()
pending = root / ".env.gemini-pending"
assert not pending.is_symlink() and pending.stat().st_mode & 0o077 == 0
key_line = pending.read_text().strip()
assert key_line.startswith("GEMINI_API_KEY=AIza") and "\n" not in key_line
key = key_line.split("=", 1)[1]
old_image = run(
    ["docker", "inspect", "--format", "{{.Image}}", "stemora-backend-1"], True
).strip()
(logs / "settings.before.env").write_bytes(before)
(logs / "old-image.json").write_text(json.dumps({"backend": old_image}) + "\n")
switched = False
try:
    phase("provider_preflight")
    sys.path.insert(0, str(root / "backend"))
    import playlist_ai

    original = {
        name: os.environ.get(name)
        for name in [
            "AI_PROVIDER",
            "GEMINI_API_KEY",
            "GEMINI_MODEL",
            "GEMINI_FALLBACK_MODEL",
        ]
    }
    probes = []
    try:
        os.environ.update(
            AI_PROVIDER="gemini", GEMINI_API_KEY=key, GEMINI_FALLBACK_MODEL="none"
        )
        for model, brief, expected in [
            (
                playlist_ai.PRIMARY_MODEL,
                "จัดเซ็ตเก้าสิบนาที ลดพลังลงเพื่อปิดงาน",
                {"target_minutes": 90, "profile": "closing"},
            ),
            (
                playlist_ai.FALLBACK_MODEL,
                "Keep energy steady for forty-five minutes",
                {"target_minutes": 45, "profile": "steady"},
            ),
        ]:
            os.environ["GEMINI_MODEL"] = model
            result = playlist_ai.extract_plan(
                brief, {"target_minutes": 60, "profile": "build"}
            )
            assert result == expected, (
                "Provider did not interpret the verification brief correctly"
            )
            probes.append({"model": model, "passed": True, "result": result})
            print("PROVIDER_CHECK:", model, "passed", flush=True)
    finally:
        for name, value in original.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
    (logs / "provider-preflight.json").write_text(json.dumps(probes, indent=2) + "\n")
    phase("building")
    run(compose + ["build", "backend"])
    phase("backing_up")
    run(["bash", "scripts/backup-docker.sh", str(root / "backups")])
    idle_check = """
import json
from database import DATA,connect
with connect() as db:
    count=db.execute("SELECT COUNT(*) FROM tracks WHERE status IN ('queued','analyzing')").fetchone()[0]
count+=sum(json.loads(p.read_text()).get('status') in {'queued','processing'} for p in (DATA/'separated').glob('*/task.json'))
print(count)
"""
    deadline = time.monotonic() + 600
    while (
        run(
            ["docker", "exec", "stemora-backend-1", "python", "-c", idle_check], True
        ).strip()
        != "0"
    ):
        phase("waiting_for_audio_jobs")
        if time.monotonic() > deadline:
            raise RuntimeError("Audio work is active; existing backend left running")
        time.sleep(5)
    assert settings.read_bytes() == before, (
        "Deployment configuration changed during the build"
    )
    updates = {
        "AI_PROVIDER": "gemini",
        "GEMINI_API_KEY": key,
        "GEMINI_MODEL": playlist_ai.PRIMARY_MODEL,
        "GEMINI_FALLBACK_MODEL": playlist_ai.FALLBACK_MODEL,
        "GEMINI_CALLS_PER_15_MIN": "100",
    }
    lines = []
    for line in before.decode().splitlines():
        name = line.split("=", 1)[0]
        if name in updates:
            lines.append(name + "=" + updates.pop(name))
        else:
            lines.append(line)
    lines.extend(name + "=" + value for name, value in updates.items())
    settings.write_text("\n".join(lines) + "\n")
    settings.chmod(0o600)
    switched = True
    phase("publishing")
    run(compose + ["up", "-d", "--no-deps", "--no-build", "backend"])
    wait_healthy()
    verify = """
import asyncio,json,os
from cloud import USER_QUOTA
from playlists import ComposeInput,understand
import playlist_ai
assert USER_QUOTA==200_000_000
assert playlist_ai.provider()=='gemini' and playlist_ai.ready()
plan,used=asyncio.run(understand(ComposeInput(prompt='จัดเซ็ตเจ็ดสิบห้านาที ค่อยเพิ่มพลังไปจนจบ')))
assert used and plan.target_minutes==75 and plan.profile=='build'
print(json.dumps({'provider':'gemini','model':os.environ['GEMINI_MODEL'],'assistant_used':used,'target_minutes':plan.target_minutes,'profile':plan.profile,'quota_bytes':USER_QUOTA}))
"""
    verification = run(
        ["docker", "exec", "stemora-backend-1", "python", "-c", verify], True
    )
    (logs / "runtime-verification.json").write_text(verification)
    with urlopen("http://172.17.0.1:18081/", timeout=10) as response:
        assert response.status == 200
    pending.unlink()
    phase(
        "ready",
        provider="gemini",
        model=playlist_ai.PRIMARY_MODEL,
        fallback=playlist_ai.FALLBACK_MODEL,
    )
except Exception:
    if switched:
        shutil.copy2(logs / "settings.before.env", settings)
        settings.chmod(0o600)
        override = logs / "rollback.compose.json"
        override.write_text(json.dumps({"services": {"backend": {"image": old_image}}}))
        run(
            compose
            + ["-f", str(override), "up", "-d", "--no-deps", "--no-build", "backend"]
        )
        wait_healthy()
        phase("rolled_back")
    else:
        phase("failed_before_publish")
    raise
