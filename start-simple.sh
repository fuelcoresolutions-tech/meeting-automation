#!/bin/bash
exec 2>&1
set -x

echo "Starting services..."
cd /app
source /app/venv/bin/activate

echo "Starting Python agent on port 8000..."
cd /app/agent && python -m uvicorn main:app --host 0.0.0.0 --port 8000 --log-level info 2>&1 &
AGENT_PID=$!
echo "Agent PID: $AGENT_PID"

# Wait for agent to be ready using Python instead of curl
echo "Waiting for agent to start..."
for i in {1..30}; do
    if python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=2)" 2>/dev/null; then
        echo "Agent is ready!"
        break
    fi
    echo "Attempt $i: Agent not ready yet..."
    sleep 1
done

echo "Starting webhook server..."
cd /app && node webhook-server.js
