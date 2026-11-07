"""Build and publish the TH/EN + 200 MB update on the existing private deployment."""

import argparse
import fcntl
import json
import os
import shutil
import socket
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

parser = argparse.ArgumentParser()
parser.add_argument("--expected-host", required=True)
args = parser.parse_args()
assert socket.gethostname() == args.expected_host, "Unexpected host"
root = Path(__file__).resolve().parents[1]
os.umask(0o077)
logs = root / "deploy-logs/quota-i18n"
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
    result = subprocess.run(
        command,
        cwd=root,
        check=True,
        text=True,
        stdout=subprocess.PIPE if capture else None,
    )
    return result.stdout.strip() if capture else None


def phase(name, **values):
    (logs / "state.json").write_text(
        json.dumps(
            {
                "phase": name,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                **values,
            },
            indent=2,
        )
        + "\n"
    )
    print("PHASE:", name, flush=True)


def healthy_backend():
    deadline = time.monotonic() + 150
    while time.monotonic() < deadline:
        if (
            run(
                [
                    "docker",
                    "inspect",
                    "--format",
                    "{{.State.Health.Status}}",
                    "stemora-backend-1",
                ],
                True,
            )
            == "healthy"
        ):
            return
        time.sleep(2)
    raise RuntimeError("Backend did not become healthy")


old = {
    service: run(
        ["docker", "inspect", "--format", "{{.Image}}", "stemora-" + service + "-1"],
        True,
    )
    for service in ["backend", "frontend"]
}
(logs / "old-images.json").write_text(json.dumps(old, indent=2) + "\n")
settings = root / ".env"
before = settings.read_bytes()
(logs / "settings.before.env").write_bytes(before)
switched = False
try:
    phase("building")
    run(compose + ["build", "backend", "frontend"])
    phase("backing_up")
    run(["bash", "scripts/backup-docker.sh", str(root / "backups")])
    idle_code = """
import json
from pathlib import Path
from database import DATA,connect
with connect() as db:
    count=db.execute("SELECT COUNT(*) FROM tracks WHERE status IN ('queued','analyzing')").fetchone()[0]
count+=sum(json.loads(p.read_text()).get('status') in {'queued','processing'} for p in (DATA/'separated').glob('*/task.json'))
print(count)
"""
    deadline = time.monotonic() + 600
    while (
        run(["docker", "exec", "stemora-backend-1", "python", "-c", idle_code], True)
        != "0"
    ):
        phase("waiting_for_audio_jobs")
        if time.monotonic() > deadline:
            raise RuntimeError("Audio jobs are still active; services left running")
        time.sleep(5)
    assert settings.read_bytes() == before, (
        "Configuration changed during build; preserving it"
    )
    lines = before.decode().splitlines()
    found = False
    for index, line in enumerate(lines):
        if line.startswith("USER_STORAGE_BYTES="):
            lines[index] = "USER_STORAGE_BYTES=200000000"
            found = True
    if not found:
        lines.append("USER_STORAGE_BYTES=200000000")
    settings.write_text("\n".join(lines) + "\n")
    settings.chmod(0o600)
    switched = True
    phase("publishing")
    run(compose + ["up", "-d", "--no-deps", "--no-build", "backend", "frontend"])
    healthy_backend()
    deadline = time.monotonic() + 45
    while True:
        try:
            with urlopen("http://172.17.0.1:18081/", timeout=5) as response:
                assert response.status == 200
            break
        except Exception:
            if time.monotonic() > deadline:
                raise
            time.sleep(2)
    run(
        [
            "docker",
            "exec",
            "stemora-backend-1",
            "python",
            "-c",
            "from cloud import USER_QUOTA; assert USER_QUOTA==200_000_000; print('QUOTA_BYTES:',USER_QUOTA)",
        ]
    )
    for locale, message in [("en", "Please log in."), ("th", "กรุณาเข้าสู่ระบบ")]:
        try:
            urlopen(
                Request(
                    "http://172.17.0.1:18082/api/cloud/tracks",
                    headers={"Accept-Language": locale},
                ),
                timeout=15,
            )
            raise AssertionError("Anonymous access was accepted")
        except HTTPError as error:
            assert error.code == 401
            assert error.headers["Content-Language"] == locale
            assert json.load(error)["detail"] == message
    phase("ready", quota_bytes=200_000_000, languages=["th", "en"])
except Exception:
    if switched:
        shutil.copy2(logs / "settings.before.env", settings)
        settings.chmod(0o600)
        override = logs / "rollback.compose.json"
        override.write_text(
            json.dumps(
                {
                    "services": {
                        service: {"image": identity}
                        for service, identity in old.items()
                    }
                }
            )
        )
        run(
            compose
            + [
                "-f",
                str(override),
                "up",
                "-d",
                "--no-deps",
                "--no-build",
                "backend",
                "frontend",
            ]
        )
        healthy_backend()
        phase("rolled_back")
    else:
        phase("failed_before_publish")
    raise
