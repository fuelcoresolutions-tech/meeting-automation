#!/bin/bash

echo "🧪 Testing local deployment..."

# Kill any existing processes
pkill -f webhook-server.js
pkill -f uvicorn

# Load environment
source .env

echo "📊 Environment:"
echo "  - PORT: $PORT"
echo "  - NODE_ENV: $NODE_ENV"

# Start webhook server
echo "🌐 Starting webhook server..."
cd /app
node webhook-server.js &
WEBHOOK_PID=$!
echo "Webhook PID: $WEBHOOK_PID"

# Wait for startup
sleep 3

# Check which port it's actually running on
echo "🔍 Checking ports..."
netstat -tlnp 2>/dev/null | grep :3000 || echo "Port 3000 not in use"
netstat -tlnp 2>/dev/null | grep :8080 || echo "Port 8080 not in use"

# Test health on both ports
echo "🏥 Testing health endpoints..."
curl -s http://localhost:3000/health && echo "✅ Port 3000 healthy" || echo "❌ Port 3000 failed"
curl -s http://localhost:8080/health && echo "✅ Port 8080 healthy" || echo "❌ Port 8080 failed"

# Show webhook server logs
echo "📋 Webhook server logs:"
ps aux | grep webhook-server | grep -v grep

# Cleanup
kill $WEBHOOK_PID 2>/dev/null
