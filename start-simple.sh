#!/bin/bash
exec 2>&1
echo "Starting services..."
cd /app
source /app/venv/bin/activate
echo "Starting Python agent on port 8000..."
cd /app/agent && python -m uvicorn main:app --host 0.0.0.0 --port 8000 > /tmp/agent.log 2>&1 &
echo "Agent PID: $!"
sleep 5
echo "Checking agent health..."
curl -s http://localhost:8000/health || echo "Agent not responding"
echo "Starting webhook server..."
cd /app && node webhook-server.js
