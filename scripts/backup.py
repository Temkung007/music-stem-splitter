"""Consistent portable database snapshot plus private objects. Run with the backend's environment."""

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "backend"))
from dotenv import load_dotenv

load_dotenv(root / ".env.storage")
from database import DATA, DRIVER, sqlite_snapshot
from storage import storage

parser = argparse.ArgumentParser()
parser.add_argument("--output", default=str(root / "backups"))
args = parser.parse_args()
destination = Path(args.output) / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
destination.mkdir(parents=True, mode=0o700, exist_ok=False)
sqlite_snapshot(destination / "workspace.sqlite3")
if (DATA / "separated").exists():
    shutil.copytree(DATA / "separated", destination / "separated")
object_root = destination / "objects"
object_root.mkdir()
count = 0
if storage.client:
    for page in storage.client.get_paginator("list_objects_v2").paginate(
        Bucket=storage.bucket
    ):
        for entry in page.get("Contents", []):
            key = entry["Key"]
            path = (object_root / key).resolve()
            if not path.is_relative_to(object_root.resolve()):
                raise RuntimeError("Unsafe object key")
            path.parent.mkdir(parents=True, exist_ok=True)
            storage.client.download_file(storage.bucket, key, str(path))
            count += 1
else:
    shutil.copytree(storage.root, object_root, dirs_exist_ok=True)
    count = sum(1 for p in object_root.rglob("*") if p.is_file())
(destination / "manifest.json").write_text(
    json.dumps(
        {
            "version": 1,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "objects": count,
            "source_driver": storage.driver,
            "database_driver": DRIVER,
        }
    )
)
for path in destination.rglob("*"):
    if path.is_file():
        path.chmod(0o600)
print(
    f"Backup created: {destination} ({count} objects). Store an encrypted copy off this server."
)
