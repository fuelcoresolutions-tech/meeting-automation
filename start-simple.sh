#!/bin/bash
echo "Starting services..."
cd /app
source /app/venv/bin/activate
cd /app/agent && python -m uvicorn main:app --host 127.0.0.1 --port 8000 &
sleep 3
cd /app && node webhook-server.js
