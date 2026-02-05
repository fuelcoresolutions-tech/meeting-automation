#!/bin/bash

# Activate Python virtual environment and start the agent in background
source /app/venv/bin/activate
cd /app/agent && python -m uvicorn main:app --host 127.0.0.1 --port 8000 &

# Wait for agent to start
sleep 3

# Start the webhook server (foreground)
cd /app && node webhook-server.js
