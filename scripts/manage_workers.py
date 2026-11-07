"""Enroll/revoke trusted operator computers without sending their raw token to the VPS."""

import argparse
import json
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from database import connect

parser = argparse.ArgumentParser()
parser.add_argument("action", choices=["enroll", "revoke", "list"])
parser.add_argument("--id")
parser.add_argument("--token-hash")
parser.add_argument("--name")
parser.add_argument("--file", type=Path, help="Private enrollment.json generated on the new Mac (hash only)")
args = parser.parse_args()
with connect() as db:
    if args.action == "enroll":
        enrollment = json.loads(args.file.read_text()) if args.file else {}
        if set(enrollment) - {"id", "name", "token_hash"}:
            parser.error("Enrollment files may contain only id, name and token_hash")
        try:
            identity = str(uuid.UUID(args.id or enrollment.get("id", "")))
        except (ValueError, TypeError):
            parser.error("A valid worker UUID is required")
        token_hash = args.token_hash or enrollment.get("token_hash", "")
        if not re.fullmatch(r"[a-f0-9]{64}", token_hash):
            parser.error("A SHA-256 token hash is required; never send the raw token")
        name = args.name or enrollment.get("name") or "STEMORA Worker"
        if not isinstance(name, str):
            parser.error("Worker name must be text")
        db.execute(
            "INSERT INTO workers(id,name,token_hash,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,token_hash=excluded.token_hash,enabled=1",
            (
                identity,
                name[:80],
                token_hash,
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        print("Worker enrolled:", identity)
    elif args.action == "revoke":
        db.execute(
            "UPDATE workers SET enabled=0 WHERE id=?", (str(uuid.UUID(args.id)),)
        )
        print("Worker revoked")
    else:
        print(
            json.dumps(
                [
                    dict(row)
                    for row in db.execute(
                        "SELECT id,name,enabled,last_seen,device,accepting FROM workers"
                    ).fetchall()
                ],
                ensure_ascii=False,
            )
        )
