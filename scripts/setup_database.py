"""Append dedicated database secrets without changing existing credentials."""

import os
import secrets
from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / ".env"
if not path.is_file():
    raise SystemExit("Run scripts/setup_deploy.py first.")
values = {}
for line in path.read_text().splitlines():
    if "=" in line and not line.startswith("#"):
        key, value = line.split("=", 1)
        values[key] = value
missing = [
    name
    for name in ("STEMORA_DB_ADMIN_PASSWORD", "STEMORA_DB_PASSWORD")
    if name not in values
]
if any(
    not values[name].strip()
    for name in values
    if name in {"STEMORA_DB_ADMIN_PASSWORD", "STEMORA_DB_PASSWORD"}
):
    raise SystemExit(
        "Existing database password is empty; repair it without rotating an initialized database."
    )
if missing:
    os.umask(0o077)
    with path.open("a") as output:
        output.write("\n# Dedicated STEMORA PostgreSQL credentials\n")
        for name in missing:
            output.write(f"{name}={secrets.token_hex(32)}\n")
path.chmod(0o600)
print("Private PostgreSQL settings ready; existing credentials preserved.")
