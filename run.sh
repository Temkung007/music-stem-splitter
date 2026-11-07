#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ "${1:-}" = "--ai" ]; then export STEMORA_AI=1; fi
BACKEND_PID=""
FRONTEND_PID=""
cleanup() {
    trap - EXIT INT TERM
    [ -z "$BACKEND_PID" ] || kill "$BACKEND_PID" 2>/dev/null || true
    [ -z "$FRONTEND_PID" ] || kill "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM
command -v node >/dev/null 2>&1 || { echo "Install Node.js 20.9+ first."; exit 1; }
for port in 3000 8000; do
    if curl -s --max-time 1 "http://127.0.0.1:$port" >/dev/null 2>&1; then
        echo "Port $port is already in use. Stop the existing server before running STEMORA."
        exit 1
    fi
done
cd "$DIR/frontend"
[ -d node_modules ] || npm ci
"$DIR/backend/start.sh" &
BACKEND_PID=$!
node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 -p 3000 &
FRONTEND_PID=$!
echo "STEMORA • http://localhost:3000"
echo "The status indicator will turn green when the backend is ready. Ctrl+C to stop."
while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do sleep 1; done
exit 1
