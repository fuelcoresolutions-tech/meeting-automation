#!/usr/bin/env bash
set -e

echo "Starting Python agent..."
source /app/venv/bin/activate
cd /app/agent
python -m uvicorn main:app --host 127.0.0.1 --port 8000 &

echo "Waiting for agent to start..."
sleep 3

echo "Starting webhook server..."
cd /app
exec node webhook-server.js
