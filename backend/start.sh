#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
if command -v uv >/dev/null 2>&1; then
    [ -d .venv ] || uv venv --python 3.12 .venv
    uv pip install --python .venv/bin/python -r requirements.txt
    if [ "${STEMORA_AI:-0}" = "1" ]; then
        uv pip install --python .venv/bin/python -r requirements-ai.txt
    fi
else
    [ -d .venv ] || python3 -m venv .venv
    .venv/bin/python -m ensurepip --upgrade
    .venv/bin/python -m pip install -r requirements.txt
    if [ "${STEMORA_AI:-0}" = "1" ]; then
        .venv/bin/python -m pip install -r requirements-ai.txt
    fi
fi
command -v ffmpeg >/dev/null 2>&1 || { echo "Install FFmpeg before starting (macOS: brew install ffmpeg)."; exit 1; }
echo "Starting STEMORA API at http://127.0.0.1:8000"
if [ -f "$DIR/../.env.storage" ]; then
    exec .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000 --env-file "$DIR/../.env.storage"
fi
exec .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000
