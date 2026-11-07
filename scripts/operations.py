"""Guarded VPS backup/monitor commands. No email or offsite transport is enabled."""
import argparse
import fcntl
import http.client
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from verify_backup import digest, verify

ROOT = Path(__file__).resolve().parents[1]
COMPOSE = ["docker", "compose", "-f", "compose.yml", "-f", "compose.nginx.yml", "--profile", "ai"]
STATE = ROOT / "operations-state"
BACKUPS = ROOT / "ops-backups"


def run(args, capture=False):
    p = subprocess.run(args, cwd=ROOT, check=True, text=True, stdout=subprocess.PIPE if capture else None, timeout=3600)
    return p.stdout.strip() if capture else None


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_suffix(".partial")
    temp.write_text(json.dumps(data, indent=2) + "\n");temp.chmod(0o600);temp.replace(path)


def publish(name, data):
    p = STATE / name;write(p, data)
    run(["docker", "exec", "--user", "root", "stemora-backend-1", "mkdir", "-p", "/data/operations"])
    remote = "/data/operations/" + name + ".pending"
    run(["docker", "cp", str(p), "stemora-backend-1:" + remote])
    run(["docker", "exec", "--user", "root", "stemora-backend-1", "chown", "10001:10001", remote])
    run(["docker", "exec", "--user", "root", "stemora-backend-1", "chmod", "0600", remote])
    run(["docker", "exec", "--user", "root", "stemora-backend-1", "mv", "-f", remote, "/data/operations/" + name])


def backup():
    BACKUPS.mkdir(exist_ok=True, mode=0o700)
    estimate_code = "from database import DATA,connect;from storage import storage;size=sum(p.stat().st_size for p in (DATA/'separated').rglob('*') if p.is_file());size+=sum(e['Size'] for page in storage.client.get_paginator('list_objects_v2').paginate(Bucket=storage.bucket) for e in page.get('Contents',[])) if storage.client else sum(p.stat().st_size for p in storage.root.rglob('*') if p.is_file());print(size)"
    estimate = int(run(["docker", "exec", "stemora-backend-1", "python", "-c", estimate_code], True))
    # Container staging + host copy + isolated restore all exist briefly together.
    if shutil.disk_usage(ROOT).free < 5_500_000_000 + 3 * estimate: raise RuntimeError("Backup disk reserve too low")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    destination = BACKUPS / (stamp + ".partial");destination.mkdir(mode=0o700)
    staging = "/data/ops-stage-" + uuid.uuid4().hex
    try:
        run(["docker", "cp", str(ROOT / "scripts/backup.py"), "stemora-backend-1:/tmp/stemora-ops-backup.py"])
        run(["docker", "exec", "--user", "root", "stemora-backend-1", "chmod", "0644", "/tmp/stemora-ops-backup.py"])
        run(["docker", "exec", "-e", "PYTHONPATH=/app", "stemora-backend-1", "python", "/tmp/stemora-ops-backup.py", "--output", staging], True)
        # Exactly this run's snapshot, never all previous backups.
        entries = json.loads(run(["docker", "exec", "stemora-backend-1", "python", "-c", f"import pathlib,json;print(json.dumps([p.name for p in pathlib.Path({staging!r}).iterdir()]))"], True))
        if len(entries) != 1 or "/" in entries[0]: raise RuntimeError("Unexpected backup staging")
        run(["docker", "cp", "stemora-backend-1:" + staging + "/" + entries[0] + "/.", str(destination)])
        with (destination / "postgresql.dump").open("wb") as f:
            subprocess.run(COMPOSE + ["exec", "-T", "database", "pg_dump", "-U", "postgres", "-d", "stemora", "--format=custom"], cwd=ROOT, check=True, stdout=f, timeout=3600)
        manifest = json.loads((destination / "manifest.json").read_text())
        manifest["files"] = {str(p.relative_to(destination)): digest(p) for p in sorted(destination.rglob("*")) if p.is_file() and p.name != "manifest.json"}
        write(destination / "manifest.json", manifest)
        result = verify(destination)
        # Restore the portable snapshot into a different directory and verify it again.
        with tempfile.TemporaryDirectory(prefix="stemora-restore-check-", dir=STATE) as check:
            target = Path(check) / "restored"
            run([sys.executable, str(ROOT / "scripts/restore.py"), str(destination), "--destination", str(target)], True)
            assert verify(target) == result
        # Validate the native PostgreSQL dump by restoring into a disposable database.
        test_db = "stemora_verify_" + uuid.uuid4().hex
        run(COMPOSE + ["exec", "-T", "database", "createdb", "-U", "postgres", test_db])
        try:
            with (destination / "postgresql.dump").open("rb") as dump:
                subprocess.run(COMPOSE + ["exec", "-T", "database", "pg_restore", "-U", "postgres", "--exit-on-error", "--no-owner", "--no-privileges", "-d", test_db], cwd=ROOT, stdin=dump, stdout=subprocess.DEVNULL, check=True, timeout=3600)
            run(COMPOSE + ["exec", "-T", "database", "psql", "-U", "postgres", "-d", test_db, "-v", "ON_ERROR_STOP=1", "-c", "SELECT COUNT(*) FROM users"], True)
        finally:
            run(COMPOSE + ["exec", "-T", "database", "dropdb", "-U", "postgres", test_db])
        write(destination / "verified.json", result)
        for p in destination.rglob("*"):
            p.chmod(0o600 if p.is_file() else 0o700)
        final = destination.with_suffix("");destination.rename(final)
        publish("backup.json", {"completed_at": time.time(), "verified": True, "snapshot": final.name, "restore_check": "passed", **result, "offsite_enabled": False})
        # Retention applies only to verified backups made by this tool.
        verified = sorted(p for p in BACKUPS.iterdir() if p.is_dir() and (p/"verified.json").is_file() and not p.name.endswith(".partial"))
        for old in verified[:-7]: shutil.rmtree(old)
        print("STEMORA backup and isolated restore check passed", final.name, flush=True)
    finally:
        run(["docker", "exec", "--user", "root", "stemora-backend-1", "rm", "-rf", staging])


def monitor():
    try:
        data = json.loads(run(["docker", "exec", "stemora-backend-1", "python", "-c", "import json;from operations import snapshot;print(json.dumps(snapshot()))"], True))
    except Exception:
        data = {"checked_at": time.time(), "database": False, "storage": False}
    try:
        connection = http.client.HTTPSConnection("stemora.mydjplus.com", timeout=15)
        connection._create_connection = lambda address, timeout, *rest: socket.create_connection(("143.198.204.118", 443), timeout)
        connection.request("GET", "/api/health", headers={"Host":"stemora.mydjplus.com"})
        response = connection.getresponse()
        body = json.loads(response.read())
        data["api"] = response.status == 200 and body.get("database_available") is True
        connection.close()
    except Exception:
        data["api"] = False
    # Evaluate inside the app so the operator's message mapping remains consistent.
    write(STATE / "snapshot.json", data)
    run(["docker", "cp", str(STATE / "snapshot.json"), "stemora-backend-1:/tmp/stemora-monitor-input.json"])
    run(["docker", "exec", "--user", "root", "stemora-backend-1", "chown", "10001:10001", "/tmp/stemora-monitor-input.json"])
    run(["docker", "exec", "--user", "root", "stemora-backend-1", "chmod", "0600", "/tmp/stemora-monitor-input.json"])
    alerts = json.loads(run(["docker", "exec", "stemora-backend-1", "python", "-c", "import json;from operations import evaluate;print(json.dumps(evaluate(json.load(open('/tmp/stemora-monitor-input.json')))))"], True))
    old = json.loads((STATE / "monitor.json").read_text()) if (STATE / "monitor.json").exists() else {}
    state = {"checked_at": time.time(), "alerts": alerts, "email_enabled": False}
    publish("monitor.json", state)
    if alerts != old.get("alerts"):
        print("STEMORA monitor changed:", ",".join(alerts) or "healthy", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser();parser.add_argument("action", choices=["backup", "monitor"]);args = parser.parse_args()
    assert socket.gethostname() == "mydjplus-ticketsplus", "Unexpected VPS"
    assert ROOT == Path("/var/www/stemora"), "Unexpected project"
    os.umask(0o077);STATE.mkdir(exist_ok=True, mode=0o700)
    with (STATE / (args.action + ".lock")).open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try: backup() if args.action == "backup" else monitor()
        except Exception:
            if args.action == "backup":
                try:
                    previous = json.loads((STATE / "backup.json").read_text()) if (STATE / "backup.json").exists() else {}
                    publish("backup.json", {**previous, "failed_at": time.time()})
                except Exception:
                    pass
            write(STATE / (args.action + "-failure.json"), {"failed_at": time.time(), "reason": "operation_failed"})
            print("STEMORA operation failed; inspect private journal", file=sys.stderr);raise
