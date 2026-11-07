"""Generate private local/VPS storage settings once. Never overwrite existing secrets."""

import secrets
from pathlib import Path

root = Path(__file__).resolve().parents[1]
config = root / "deploy" / "garage.toml"
env = root / ".env.storage"
if env.exists() or config.exists():
    raise SystemExit(
        "Storage configuration exists; reusing it is safer than rotating keys. See deploy/README.md."
    )
access = "GK" + secrets.token_hex(16)
secret = secrets.token_hex(32)
config.write_text(f'''metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "sqlite"
replication_factor = 1
rpc_bind_addr = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = "{secrets.token_hex(32)}"
[s3_api]
s3_region = "garage"
api_bind_addr = "[::]:3900"
[admin]
api_bind_addr = "[::]:3903"
admin_token = "{secrets.token_hex(32)}"
''')
env.write_text(f"""GARAGE_DEFAULT_ACCESS_KEY={access}
GARAGE_DEFAULT_SECRET_KEY={secret}
GARAGE_DEFAULT_BUCKET=stemora
STORAGE_DRIVER=s3
S3_ENDPOINT=http://127.0.0.1:13900
S3_REGION=garage
S3_BUCKET=stemora
S3_ACCESS_KEY={access}
S3_SECRET_KEY={secret}
""")
config.chmod(0o600)
env.chmod(0o600)
print(
    "Created .env.storage and deploy/garage.toml. Keys are private; no credentials printed."
)
