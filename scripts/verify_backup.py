"""Verify portable DB, referenced cloud objects and every recorded file checksum."""
import hashlib
import json
import sqlite3
from pathlib import Path


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""): h.update(chunk)
    return h.hexdigest()


def verify(root):
    root = Path(root).resolve(strict=True)
    manifest = json.loads((root / "manifest.json").read_text())
    if manifest.get("version") != 1: raise ValueError("Invalid backup version")
    with sqlite3.connect((root / "workspace.sqlite3").as_uri() + "?mode=ro", uri=True) as db:
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok" or db.execute("PRAGMA foreign_key_check").fetchall(): raise ValueError("Invalid portable database")
        for table in ["tracks", "assets"]:
            for (key,) in db.execute(f"SELECT object_key FROM {table}"):
                # A queued job reserves an output key before the file exists.
                if "/worker-reservation/" in key: continue
                path = (root / "objects" / key).resolve()
                if not path.is_relative_to(root / "objects") or not path.is_file(): raise ValueError("Referenced object missing")
    files = manifest.get("files")
    if not isinstance(files, dict) or not files: raise ValueError("Backup lacks checksums")
    for name, expected in files.items():
        path = (root / name).resolve()
        if not path.is_relative_to(root) or path.is_symlink() or digest(path) != expected: raise ValueError("Backup checksum mismatch")
    actual = {str(p.relative_to(root)) for p in root.rglob("*") if p.is_file() and p.name not in {"manifest.json", "verified.json"}}
    if actual != set(files): raise ValueError("Backup file inventory mismatch")
    return {"files": len(files), "objects": manifest["objects"], "database": "integrity_and_references_passed"}


if __name__ == "__main__":
    import sys
    print(json.dumps(verify(sys.argv[1])))
