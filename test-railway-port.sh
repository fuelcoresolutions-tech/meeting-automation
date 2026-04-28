#!/bin/bash

echo "🧪 Testing Railway port configuration..."

# Kill any existing processes
pkill -f webhook-server.js
pkill -f uvicorn

# Set Railway-like environment
export PORT=8080
export NODE_ENV=production

echo "📊 Environment: PORT=${PORT}, NODE_ENV=${NODE_ENV}"

# Start webhook server
echo "🌐 Starting webhook server..."
node webhook-server.js > /tmp/webhook-railway.log 2>&1 &
WEBHOOK_PID=$!
echo "Webhook PID: $WEBHOOK_PID"

# Wait for startup
sleep 3

# Test health check using Railway's PORT
echo "🏥 Testing health endpoint on port ${PORT}..."
if curl -f http://localhost:${PORT}/health > /dev/null 2>&1; then
    echo "✅ Health check successful on port ${PORT}"
else
    echo "❌ Health check failed on port ${PORT}"
    echo "🔍 Debug info:"
    echo "  - PORT=${PORT}"
    echo "  - Webhook logs:"
    tail -5 /tmp/webhook-railway.log
fi

# Cleanup
kill $WEBHOOK_PID 2>/dev/null
