#!/bin/bash
# Railway startup script with enhanced logging and immediate processing

set -e

http_ok() {
    node -e "
        const url = process.argv[1];
        fetch(url)
            .then((response) => process.exit(response.ok ? 0 : 1))
            .catch(() => process.exit(1));
    " "$1" > /dev/null 2>&1
}

http_post() {
    node -e "
        const url = process.argv[1];
        fetch(url, { method: 'POST' })
            .then((response) => process.exit(response.ok ? 0 : 1))
            .catch((error) => {
                console.error(error.message);
                process.exit(1);
            });
    " "$1"
}

echo "🚀 Starting Meeting Automation System on Railway"
echo "=============================================="

# Set environment for Railway
export PORT="${PORT:-3000}"
export NODE_ENV="${NODE_ENV:-production}"
export LOG_LEVEL="${LOG_LEVEL:-info}"
export ENABLE_IMMEDIATE_PROCESSING="${ENABLE_IMMEDIATE_PROCESSING:-true}"
export ENABLE_DURABLE_RETRY_WORKER="${ENABLE_DURABLE_RETRY_WORKER:-true}"
export RETRY_POLL_SECONDS="${RETRY_POLL_SECONDS:-10}"
export MAX_RETRY_ATTEMPTS="${MAX_RETRY_ATTEMPTS:-50}"
export CLAUDE_AGENT_URL="${CLAUDE_AGENT_URL:-http://127.0.0.1:8000}"
export NOTION_API_BASE="${NOTION_API_BASE:-http://127.0.0.1:${PORT}}"
PYTHON_BIN="${PYTHON_BIN:-/app/venv/bin/python}"

# Log environment status
echo "📊 Environment Configuration:"
echo "  - PORT: $PORT"
echo "  - NODE_ENV: $NODE_ENV"
echo "  - LOG_LEVEL: $LOG_LEVEL"
echo "  - ENABLE_IMMEDIATE_PROCESSING: $ENABLE_IMMEDIATE_PROCESSING"
echo "  - ENABLE_DURABLE_RETRY_WORKER: $ENABLE_DURABLE_RETRY_WORKER"
echo "  - RETRY_POLL_SECONDS: $RETRY_POLL_SECONDS"
echo "  - MAX_RETRY_ATTEMPTS: $MAX_RETRY_ATTEMPTS"
echo "  - CLAUDE_AGENT_URL: $CLAUDE_AGENT_URL"
echo "  - NOTION_API_BASE: $NOTION_API_BASE"

if [ ! -x "$PYTHON_BIN" ]; then
    echo "❌ ERROR: Python runtime not found at $PYTHON_BIN"
    exit 1
fi

# Check API keys (skip validation for local testing)
echo "🔑 Checking API Keys..."
if [ "$NODE_ENV" = "production" ]; then
    if [ -z "$ANTHROPIC_API_KEY" ] || [ "$ANTHROPIC_API_KEY" = "your_anthropic_api_key" ]; then
        echo "❌ ERROR: ANTHROPIC_API_KEY is missing or placeholder"
        echo "📝 Please set ANTHROPIC_API_KEY in Railway environment variables"
        exit 1
    fi

    if [ -z "$FIREFLY_API_KEY" ] || [ "$FIREFLY_API_KEY" = "your_fireflies_api_key" ]; then
        echo "❌ ERROR: FIREFLY_API_KEY is missing or placeholder"
        echo "📝 Please set FIREFLY_API_KEY in Railway environment variables"
        exit 1
    fi

    if [ -z "$NOTION_KEY" ] || [ "$NOTION_KEY" = "your_notion_integration_key" ]; then
        echo "❌ ERROR: NOTION_KEY is missing or placeholder"
        echo "📝 Please set NOTION_KEY in Railway environment variables"
        exit 1
    fi
    echo "✅ API keys validated"
else
    echo "⚠️ Local mode: skipping API key validation"
fi

# Create log directory
mkdir -p /tmp/logs
touch /tmp/logs/webhook.log /tmp/logs/agent.log /tmp/logs/immediate-retry.log /tmp/logs/status.log

# Surface service logs in Railway so webhook and worker activity is visible.
tail -n 0 -F /tmp/logs/webhook.log /tmp/logs/agent.log /tmp/logs/immediate-retry.log /tmp/logs/status.log &
LOG_TAIL_PID=$!
echo "📡 Streaming service logs to Railway output (tail PID: $LOG_TAIL_PID)"

# Start webhook server in background
echo "🌐 Starting webhook server..."
echo "🔧 Environment: PORT=${PORT}, NODE_ENV=${NODE_ENV}"
echo "🔧 Working directory: $(pwd)"
node webhook-server.js > /tmp/logs/webhook.log 2>&1 &
WEBHOOK_PID=$!
echo "Webhook server PID: $WEBHOOK_PID"
sleep 2  # Give server time to start and potentially fail
if ! kill -0 $WEBHOOK_PID 2>/dev/null; then
    echo "❌ Webhook server died immediately"
    echo "🔍 Error details:"
    cat /tmp/logs/webhook.log 2>/dev/null || echo "No logs available"
    exit 1
fi

# Wait for webhook server to start
echo "⏳ Waiting for webhook server to start..."
for i in {1..30}; do
    if http_ok "http://127.0.0.1:${PORT}/health"; then
        echo "✅ Webhook server is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ Webhook server failed to start"
        echo "🔍 Checking webhook server logs..."
        tail -10 /tmp/logs/webhook.log 2>/dev/null || echo "No webhook logs available"
        echo "🔧 Debug info: PORT=${PORT}, trying http://127.0.0.1:${PORT}/health"
        exit 1
    fi
    sleep 1
done

# Start Python agent
echo "🤖 Starting Python agent..."
cd /app/agent
"$PYTHON_BIN" -m uvicorn main:app --host 0.0.0.0 --port 8000 --log-level info > /tmp/logs/agent.log 2>&1 &
AGENT_PID=$!
echo "Agent PID: $AGENT_PID"

# Wait for agent to start
echo "⏳ Waiting for agent to start..."
for i in {1..30}; do
    if http_ok "http://127.0.0.1:8000/health"; then
        echo "✅ Agent is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ Agent failed to start"
        echo "🔍 Checking agent logs..."
        tail -10 /tmp/logs/agent.log 2>/dev/null || echo "No agent logs available"
        exit 1
    fi
    sleep 1
done

# Show service URLs
echo "📍 Services started successfully:"
echo "  - Webhook Server: http://localhost:${PORT}"
echo "  - Agent: http://localhost:8000"
echo "  - Health: http://localhost:${PORT}/health"

# Force immediate processing of pending meetings
echo "🔄 Processing pending meetings immediately..."
http_post "http://127.0.0.1:8000/worker/retry-pending-now" > /tmp/logs/immediate-retry.log 2>&1 &
RETRY_PID=$!

# Monitor and log
echo "📊 Monitoring services..."
echo "📋 Logs available at:"
echo "  - Webhook: /tmp/logs/webhook.log"
echo "  - Agent: /tmp/logs/agent.log"
echo "  - Retry: /tmp/logs/immediate-retry.log"

# Keep the container running and monitor services
while true; do
    # Check if services are still running
    if ! kill -0 $WEBHOOK_PID 2>/dev/null; then
        echo "❌ Webhook server died, restarting..."
        node webhook-server.js > /tmp/logs/webhook.log 2>&1 &
        WEBHOOK_PID=$!
    fi
    
    if ! kill -0 $AGENT_PID 2>/dev/null; then
        echo "❌ Agent died, restarting..."
        cd /app/agent
        "$PYTHON_BIN" -m uvicorn main:app --host 0.0.0.0 --port 8000 --log-level info > /tmp/logs/agent.log 2>&1 &
        AGENT_PID=$!
    fi
    
    echo "$(date): Services running - Webhook PID: $WEBHOOK_PID, Agent PID: $AGENT_PID" >> /tmp/logs/status.log
    
    sleep 300
done
