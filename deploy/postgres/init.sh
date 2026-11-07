#!/usr/bin/env bash
set -euo pipefail
# App credentials are separate from the administrator and never logged.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_password="$STEMORA_DB_PASSWORD" <<'SQL'
CREATE ROLE stemora LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER DATABASE stemora OWNER TO stemora;
GRANT ALL ON SCHEMA public TO stemora;
SQL
