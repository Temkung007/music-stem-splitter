"""Guarded source + image deployment to the user's existing STEMORA VPS."""

import argparse
import fcntl
import hashlib
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
parser.add_argument("--source-directory", type=Path, required=True)
parser.add_argument("--attempt", type=int, default=1)
mode = parser.add_mutually_exclusive_group()
mode.add_argument("--runtime-fix", action="store_true")
mode.add_argument("--upload-fix", action="store_true")
mode.add_argument("--worker-agent", action="store_true")
args = parser.parse_args()
assert socket.gethostname() == "mydjplus-ticketsplus"
assert os.environ["SSH_CONNECTION"].split()[2] == "143.198.204.118"
root = Path("/var/www/stemora")
source = args.source_directory.resolve()
base_suffix = (
    "worker-agent-20261030"
    if args.worker_agent
    else "webgpu-upload-20261029"
    if args.upload_fix
    else "webgpu-runtime-20261029"
    if args.runtime_fix
    else "webgpu-20261029"
)
assert 1 <= args.attempt <= 99
suffix = base_suffix + (f"-r{args.attempt}" if args.attempt > 1 else "")
services = ["frontend"] if args.runtime_fix else ["backend", "frontend"]
assert source == root / ("incoming-" + base_suffix)
os.umask(0o077)
logs = root / "deploy-logs" / suffix
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
manifest = json.loads((source / "STEMORA_SOURCE.json").read_text())
removed = manifest.get("removed", {})
names = list(manifest["files"]) + ["STEMORA_SOURCE.json"] + list(removed)
allowed = {
    ".gitignore",
    "README.md",
    "run.sh",
    "compose.yml",
    "compose.ai.yml",
    "compose.nginx.yml",
    "compose.storage.yml",
}
for name in names:
    path = Path(name)
    assert not path.is_absolute() and ".." not in path.parts
    assert (
        name in allowed
        or path.parts[0]
        in {"backend", "frontend", "deploy", "docs", "scripts", "worker"}
        or name == "STEMORA_SOURCE.json"
    )
    assert all(not piece.startswith(".env") for piece in path.parts)
    assert name != "deploy/garage.toml" and not (source / name).is_symlink()
    if name not in removed:
        assert (source / name).is_file()
    if name in manifest["files"]:
        assert (
            hashlib.sha256((source / name).read_bytes()).hexdigest()
            == manifest["files"][name]
        )


def run(command, capture=False):
    result = subprocess.run(
        command,
        cwd=root,
        check=True,
        text=True,
        stdout=subprocess.PIPE if capture else None,
    )
    return result.stdout.strip() if capture else None


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


def wait_health():
    deadline = time.monotonic() + 180
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
    raise RuntimeError("Backend health timeout")


def http_ready():
    deadline = time.monotonic() + 90
    while True:
        try:
            with urlopen("http://172.17.0.1:18081/", timeout=10) as response:
                assert response.status == 200
            return
        except Exception:
            if time.monotonic() > deadline:
                raise
            time.sleep(2)


settings = root / ".env"
settings_before = settings.read_bytes()
settings_expected = settings_before
vhost = Path("/var/www/TicketPlus-dashboard/nginx/conf.d/stemora.mydjplus.com.conf")
vhost_before = vhost.read_bytes()
assert "server_name stemora.mydjplus.com;" in vhost_before.decode()
backup = root / "rollback" / ("source-before-" + suffix)
assert not backup.exists(), (
    "A prior deployment backup exists; inspect its state before retrying"
)
backup.mkdir(parents=True)
(logs / "nginx.before.conf").write_bytes(vhost_before)
old_images = {
    service: run(
        ["docker", "inspect", "--format", "{{.Image}}", "stemora-" + service + "-1"],
        True,
    )
    for service in services
}
# Preserve named rollback references before build replaces the application tags.
rollback_suffix = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
for service, identity in list(old_images.items()):
    reference = "stemora-" + service + ":rollback-" + rollback_suffix
    run(["docker", "image", "tag", identity, reference])
    old_images[service] = reference
(logs / "old-images.json").write_text(json.dumps(old_images, indent=2) + "\n")
existed = []
published = False
nginx_changed = False
try:
    phase("installing_verified_source", files=len(manifest["files"]))
    for name in names:
        target = root / name
        if target.exists():
            assert target.is_file() and not target.is_symlink()
            saved = backup / name
            saved.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, saved)
            existed.append(name)
        if name in removed:
            if target.exists():
                assert hashlib.sha256(target.read_bytes()).hexdigest() == removed[name]
                target.unlink()
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / name, target)
    (logs / "existed.json").write_text(json.dumps(existed) + "\n")
    phase("building")
    run(compose + ["build"] + services)
    phase("waiting_for_audio_jobs")
    idle_code = """
import json
from database import DATA,connect
with connect() as db:
    count=db.execute("SELECT COUNT(*) FROM tracks WHERE status IN ('queued','analyzing')").fetchone()[0]
    count+=db.execute("SELECT COUNT(*) FROM stem_jobs WHERE status='processing'").fetchone()[0]
count+=sum(json.loads(p.read_text()).get('status') in {'queued','processing'} for p in (DATA/'separated').glob('*/task.json'))
print(count)
"""
    deadline = time.monotonic() + 600
    while (
        run(["docker", "exec", "stemora-backend-1", "python", "-c", idle_code], True)
        != "0"
    ):
        if time.monotonic() > deadline:
            raise RuntimeError("Existing audio jobs are active; publication cancelled")
        time.sleep(5)
    phase("backing_up")
    run(["bash", "scripts/backup-docker.sh", str(root / "backups")])
    assert settings.read_bytes() == settings_before, (
        "Deployment settings changed during build"
    )
    assert vhost.read_bytes() == vhost_before, "Live vhost changed during build"
    if args.worker_agent:
        import re

        (logs / "settings.before.env").write_bytes(settings_before)
        updated = settings_before.decode()
        if re.search(r"(?m)^STEMORA_WORKER_ENABLED=", updated):
            updated = re.sub(
                r"(?m)^STEMORA_WORKER_ENABLED=.*$", "STEMORA_WORKER_ENABLED=1", updated
            )
        else:
            updated = updated.rstrip() + "\nSTEMORA_WORKER_ENABLED=1\n"
        settings_expected = updated.encode()
        settings.write_bytes(settings_expected)
        settings.chmod(0o600)
    updated_vhost = vhost_before.decode()
    if "client_max_body_size 110m;" in updated_vhost:
        assert updated_vhost.count("client_max_body_size 110m;") == 1
        vhost.write_text(
            updated_vhost.replace(
                "client_max_body_size 110m;", "client_max_body_size 205m;"
            )
        )
        nginx_changed = True
    else:
        assert "client_max_body_size 205m;" in updated_vhost
    run(["docker", "exec", "ticketsplus-nginx", "nginx", "-t"])
    phase("publishing")
    published = True
    run(compose + ["up", "-d", "--no-deps", "--no-build"] + services)
    wait_health()
    if args.worker_agent:
        registration = manifest["worker_registration"]
        run(
            [
                "docker",
                "cp",
                str(root / "scripts/manage_workers.py"),
                "stemora-backend-1:/app/manage_workers.py",
            ]
        )
        run(
            [
                "docker",
                "exec",
                "--user",
                "root",
                "stemora-backend-1",
                "chmod",
                "0644",
                "/app/manage_workers.py",
            ]
        )
        run(
            [
                "docker",
                "exec",
                "stemora-backend-1",
                "python",
                "/app/manage_workers.py",
                "enroll",
                "--id",
                registration["id"],
                "--token-hash",
                registration["token_hash"],
                "--name",
                registration["name"],
            ]
        )
        with urlopen("http://172.17.0.1:18082/api/health", timeout=15) as response:
            assert json.load(response)["worker_enabled"] is True
    if nginx_changed:
        run(["docker", "exec", "ticketsplus-nginx", "nginx", "-s", "reload"])
    http_ready()
    checks = {}
    asset_manifest = json.loads(
        (root / "frontend/public/client-stems/assets.json").read_text()
    )
    assets = [("/client-stems/" + asset_manifest.get("worker", "worker.js"), None)] + [
        ("/client-stems/assets/" + item["name"], item["bytes"])
        for item in asset_manifest["files"]
    ]
    for path, size in assets:
        with urlopen(
            Request("http://172.17.0.1:18081" + path, method="HEAD"), timeout=30
        ) as response:
            assert response.status == 200
            if size:
                assert int(response.headers["Content-Length"]) == size
            if path.endswith(".wasm"):
                assert response.headers["Content-Type"].startswith("application/wasm")
            checks[path] = "passed"
    for locale in ["th", "en"]:
        for endpoint in ["/api/client-stems", "/api/client-stems/uploads"]:
            try:
                urlopen(
                    Request(
                        "http://172.17.0.1:18082" + endpoint,
                        data=b"",
                        headers={"Accept-Language": locale},
                    ),
                    timeout=15,
                )
                raise AssertionError("Anonymous import was accepted")
            except HTTPError as error:
                assert error.code == 401 and error.headers["Content-Language"] == locale
    run(
        [
            "docker",
            "exec",
            "stemora-backend-1",
            "python",
            "-c",
            "import os; from cloud import USER_QUOTA; assert USER_QUOTA==200_000_000; assert os.environ['AI_PROVIDER']=='gemini'; print('RUNTIME_SETTINGS_VERIFIED')",
        ]
    )
    assert (
        run(
            [
                "docker",
                "inspect",
                "--format",
                "{{.State.Health.Status}}",
                "ticketsplus-app",
            ],
            True,
        )
        == "healthy"
    )
    assert settings.read_bytes() == settings_expected
    (logs / "verification.json").write_text(json.dumps(checks, indent=2) + "\n")
    phase(
        "origin_ready",
        client_stems=True,
        quota_bytes=200_000_000,
        languages=["th", "en"],
    )
except Exception:
    phase("recovering", publication_started=published)
    if args.worker_agent:
        settings.write_bytes(settings_before)
        settings.chmod(0o600)
    if nginx_changed:
        vhost.write_bytes(vhost_before)
        run(["docker", "exec", "ticketsplus-nginx", "nginx", "-t"])
        run(["docker", "exec", "ticketsplus-nginx", "nginx", "-s", "reload"])
    if published:
        override = logs / "rollback.compose.json"
        override.write_text(
            json.dumps(
                {
                    "services": {
                        service: {"image": identity}
                        for service, identity in old_images.items()
                    }
                }
            )
        )
        try:
            run(
                compose
                + [
                    "-f",
                    str(override),
                    "up",
                    "-d",
                    "--no-deps",
                    "--no-build",
                ]
                + services
            )
            wait_health()
        except Exception:
            phase("recovery_required", publication_started=True)
            raise
    for name in names:
        if (backup / name).is_file():
            shutil.copy2(backup / name, root / name)
        elif name not in existed:
            (root / name).unlink(missing_ok=True)
    phase("rolled_back", publication_started=published)
    raise
