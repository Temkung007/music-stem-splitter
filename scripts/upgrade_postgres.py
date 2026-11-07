"""Prepare, then migrate an existing single-host SQLite deployment to PostgreSQL.

Run prepare while the old backend serves traffic. Activate only after testing the source.
Keeps the old image, SQLite file, private environment and full pre-migration backup.
"""

import argparse
import fcntl
import json
import os
import socket
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("mode", choices=["prepare", "activate"])
parser.add_argument("--expected-host", required=True)
args = parser.parse_args()
if socket.gethostname() != args.expected_host:
    raise SystemExit("Unexpected host; no changes made")
os.umask(0o077)
log_dir = root / "deploy-logs/postgres-upgrade"
log_dir.mkdir(parents=True, exist_ok=True)
lock = (log_dir / "lock").open("w")
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
state_file = log_dir / "state.json"
state = json.loads(state_file.read_text()) if state_file.exists() else {}
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


def phase(name, **values):
    state.update(
        phase=name, updated_at=datetime.now(timezone.utc).isoformat(), **values
    )
    state_file.write_text(json.dumps(state, indent=2) + "\n")
    print("PHASE:", name, flush=True)


def run(command, capture=False):
    result = subprocess.run(
        command,
        cwd=root,
        check=True,
        text=True,
        stdout=subprocess.PIPE if capture else None,
    )
    return result.stdout.strip() if capture else None


def container(service):
    return run(compose + ["ps", "-q", service], capture=True)


def healthy(service, timeout=150):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        identity = container(service)
        if (
            identity
            and run(
                ["docker", "inspect", "--format", "{{.State.Health.Status}}", identity],
                capture=True,
            )
            == "healthy"
        ):
            return
        time.sleep(2)
    raise RuntimeError(service + " did not become healthy")


if args.mode == "prepare":
    run(["python3", "scripts/setup_database.py"])

backend = container("backend")
if not backend:
    raise SystemExit("Existing backend must be running")
environment = json.loads(
    run(
        ["docker", "inspect", "--format", "{{json .Config.Env}}", backend], capture=True
    )
)
if "DATABASE_DRIVER=postgresql" in environment:
    raise SystemExit("Backend already uses PostgreSQL; refusing to migrate again")

if args.mode == "prepare":
    state["old_backend_image"] = run(
        ["docker", "inspect", "--format", "{{.Image}}", backend], capture=True
    )
    phase("preparing")
    run(compose + ["build", "backend"])
    run(compose + ["up", "-d", "--no-deps", "database"])
    healthy("database")
    phase("prepared")
    raise SystemExit(0)

if state.get("phase") != "prepared" or not state.get("old_backend_image"):
    raise SystemExit("Run prepare first")

# Do not interrupt audio work. A later retry can activate when the workspace is idle.
idle_code = """
import json,os,sqlite3
from pathlib import Path
data=Path(os.environ['STEMORA_DATA_DIR'])
with sqlite3.connect(data/'workspace.sqlite3') as db:
    active=db.execute("SELECT COUNT(*) FROM tracks WHERE status IN ('queued','analyzing')").fetchone()[0]
active+=sum(json.loads(p.read_text()).get('status') in {'queued','processing'} for p in (data/'separated').glob('*/task.json'))
print(active)
"""
if run(["docker", "exec", backend, "python", "-c", idle_code], capture=True) != "0":
    raise SystemExit(
        "Audio work is active. Backend left running; activate again when idle."
    )

old_backup = root / "rollback/source-before-postgres/scripts/backup.py"
if not old_backup.is_file():
    raise SystemExit("Missing original backup script; backend left running")
phase("backing_up")
run(["docker", "cp", str(old_backup), backend + ":/tmp/stemora-pre-postgres-backup.py"])
run(
    [
        "docker",
        "exec",
        "-e",
        "PYTHONPATH=/app",
        backend,
        "python",
        "/tmp/stemora-pre-postgres-backup.py",
        "--output",
        "/data/backups",
    ]
)
(root / "backups").mkdir(exist_ok=True)
run(["docker", "cp", backend + ":/data/backups/.", str(root / "backups")])

stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
migration_code = f"""
import json,os,sqlite3
from database import DATA,DB_PATH,import_sqlite
os.umask(0o077)
folder=DATA/'migrations'/{stamp!r}
folder.mkdir(parents=True,exist_ok=False)
snapshot=folder/'workspace.sqlite3'
with sqlite3.connect(DB_PATH) as source,sqlite3.connect(snapshot) as target:
    source.backup(target)
report=import_sqlite(snapshot)
(folder/'report.json').write_text(json.dumps(report,indent=2)+'\\n')
print(json.dumps({{'snapshot':str(snapshot),'tables':report}}))
"""
stopped = False
started = False
try:
    phase("migrating", snapshot=f"/data/migrations/{stamp}/workspace.sqlite3")
    run(compose + ["stop", "-t", "60", "backend"])
    stopped = True
    result = run(
        compose
        + [
            "run",
            "--rm",
            "--no-deps",
            "-T",
            "--name",
            "stemora-db-import",
            "backend",
            "python",
            "-c",
            migration_code,
        ],
        capture=True,
    )
    report = json.loads(result.splitlines()[-1])
    (log_dir / "migration.json").write_text(json.dumps(report, indent=2) + "\n")
    run(compose + ["up", "-d", "--no-deps", "--no-build", "backend"])
    started = True
    healthy("backend")
    with urlopen(
        "http://"
        + os.environ.get("STEMORA_VERIFY_HOST", "172.17.0.1")
        + ":18082/api/health",
        timeout=15,
    ) as response:
        assert json.load(response)["database_available"] is True
    phase(
        "ready",
        rows={table: entry["rows"] for table, entry in report["tables"].items()},
    )
except Exception:
    if stopped:
        run(compose + ["stop", "-t", "30", "backend"])
        safe_to_rollback = not started
        if started:
            verify_code = "from database import connect,TABLES,table_digest; import json;\nwith connect() as db:\n print(json.dumps({table:table_digest(db.execute('SELECT * FROM '+table).fetchall()) for table in TABLES}))"
            actual = json.loads(
                run(
                    compose
                    + [
                        "run",
                        "--rm",
                        "--no-deps",
                        "-T",
                        "backend",
                        "python",
                        "-c",
                        verify_code,
                    ],
                    capture=True,
                ).splitlines()[-1]
            )
            safe_to_rollback = actual == {
                table: entry["sha256"] for table, entry in report["tables"].items()
            }
        if safe_to_rollback:
            override = log_dir / "rollback.compose.json"
            override.write_text(
                json.dumps(
                    {
                        "services": {
                            "backend": {
                                "image": state["old_backend_image"],
                                "environment": {"DATABASE_DRIVER": "sqlite"},
                            }
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
                ]
            )
            healthy("backend")
            phase("rolled_back")
        else:
            phase(
                "repair_required",
                reason="PostgreSQL received writes; preserved to avoid losing new data",
            )
    raise
