#!/bin/bash
echo "Starting services..."
cd /app
source /app/venv/bin/activate
cd /app/agent && python -m uvicorn main:app --host 0.0.0.0 --port 8000 &
sleep 3
cd /app && node webhook-server.js
