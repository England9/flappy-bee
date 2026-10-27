#!/bin/bash
# Double-click this file on macOS to play Flappy Bee locally.
set -euo pipefail
cd "$(dirname "$0")"

echo "=== Flappy Bee ==="
echo "Folder: $(pwd)"
echo

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js / npm not found."
  echo "Install Node LTS from https://nodejs.org or run: brew install node"
  echo
  read -r -p "Press Enter to close…"
  exit 1
fi

echo "Node $(node -v) · npm $(npm -v)"
echo

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies (first run)…"
  npm install
  echo
fi

PORT=43127
URL="http://127.0.0.1:${PORT}"

(sleep 1.5 && open "$URL") &

echo "Starting game at ${URL}"
echo "Leave this window open while you play. Close it (or Ctrl+C) to stop."
echo
npm run dev