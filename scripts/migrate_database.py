"""Import a SQLite snapshot into an EMPTY dedicated PostgreSQL database."""

import argparse
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "backend"))
from database import import_sqlite

parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
args = parser.parse_args()
print(json.dumps(import_sqlite(args.source), indent=2))
