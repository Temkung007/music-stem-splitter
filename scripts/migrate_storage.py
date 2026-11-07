"""Copy a restored/local object tree to the configured S3 bucket; preserve the source."""

import argparse
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "backend"))
from dotenv import load_dotenv

load_dotenv(root / ".env.storage")
from storage import storage

parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
args = parser.parse_args()
if storage.driver != "s3":
    raise SystemExit("Configure private S3 storage first.")
count = 0
for path in args.source.rglob("*"):
    if path.is_file():
        storage.put(path, path.relative_to(args.source).as_posix())
        count += 1
print(
    f"Copied {count} objects. Source files retained; switch the data directory only after validation."
)
