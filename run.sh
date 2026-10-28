#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "=========================================================="
echo "      🎵 StemX - Music Stem Splitter Launcher 🎵         "
echo "=========================================================="

cleanup() {
    echo ""
    echo "Stopping servers..."
    kill $(jobs -p) 2>/dev/null || true
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# 1. Start Python Backend
echo "[1/2] Starting Python Backend on http://localhost:8000..."
cd "$DIR/backend"
if [ ! -d ".venv" ]; then
    echo "Initializing virtual environment..."
    uv venv --python 3.12 .venv
    uv pip install --python .venv/bin/python -r requirements.txt
fi
.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# Wait for backend to respond
sleep 2

# 2. Start Next.js Frontend
echo "[2/2] Starting Next.js Frontend on http://localhost:3000..."
cd "$DIR/frontend"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "🚀 StemX is running!"
echo "👉 Open Web Browser: http://localhost:3000"
echo "👉 Backend API Docs: http://localhost:8000/docs"
echo "Press Ctrl+C to stop all servers."
echo ""

wait
