#!/usr/bin/env bash
set -e
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

if [ ! -d ".venv" ]; then
    echo "Virtual environment not found. Setting up..."
    /Users/temkung007/.local/bin/uv venv --python 3.12 .venv
    /Users/temkung007/.local/bin/uv pip install --python .venv/bin/python -r requirements.txt
fi

echo "Starting Music Stem Splitter Backend on http://localhost:8000..."
exec .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload
