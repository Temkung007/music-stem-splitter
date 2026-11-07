"""Restore a backup to a NEW directory. Existing data is never overwritten."""

import argparse
import json
import shutil
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("backup", type=Path)
parser.add_argument("--destination", type=Path, required=True)
args = parser.parse_args()
manifest = json.loads((args.backup / "manifest.json").read_text())
if manifest.get("version") != 1 or not (args.backup / "workspace.sqlite3").is_file():
    raise SystemExit("Invalid backup")
if args.destination.exists():
    raise SystemExit("Destination exists. Choose a new, empty path.")
shutil.copytree(args.backup, args.destination)
print(
    "Restored. Start with STEMORA_DATA_DIR set to this directory and STORAGE_DRIVER=local, or migrate objects to your private S3 first."
)
