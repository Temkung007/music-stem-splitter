"""Generate deployment configuration without printing or overwriting secrets."""

import argparse
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument(
    "--domain", help="Public hostname, e.g. music.example.com; enables HTTPS"
)
args = parser.parse_args()
if (root / ".env").exists():
    raise SystemExit(".env already exists. Edit it in place to preserve credentials.")
if not (root / ".env.storage").exists():
    subprocess.run([sys.executable, str(root / "scripts/setup_storage.py")], check=True)
values = {}
for line in (root / ".env.storage").read_text().splitlines():
    if "=" in line and not line.startswith("#"):
        key, value = line.split("=", 1)
        values[key] = value
if args.domain:
    import re

    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9.-]+[a-zA-Z0-9]", args.domain):
        raise SystemExit("Use a hostname without protocol or path.")
    address = args.domain
    origin = "https://" + args.domain
    secure = "1"
    http = "80"
    https = "443"
else:
    address = "http://localhost"
    origin = "http://localhost:8080"
    secure = "0"
    http = "8080"
    https = "8443"
content = f"""# Generated locally. Keep this file private and include it in your secure backup.
SITE_ADDRESS={address}
APP_ORIGIN={origin}
HTTP_PORT={http}
HTTPS_PORT={https}
BIND_ADDRESS={"0.0.0.0" if args.domain else "127.0.0.1"}
COOKIE_SECURE={secure}
ALLOW_REGISTRATION=1
INSTALL_AUDIO_AI=true
USER_STORAGE_BYTES=200000000
AI_PROVIDER=ollama
AI_BASE_URL=http://assistant:11434
AI_MODEL=qwen2.5:1.5b
"""
content += (
    "\n".join(
        f"{key}={values[key]}"
        for key in [
            "GARAGE_DEFAULT_ACCESS_KEY",
            "GARAGE_DEFAULT_SECRET_KEY",
            "GARAGE_DEFAULT_BUCKET",
        ]
    )
    + "\n"
)
path = root / ".env"
path.write_text(content)
path.chmod(0o600)
subprocess.run([sys.executable, str(root / "scripts/setup_database.py")], check=True)
print(f"Created private deployment settings. App address: {origin}")
