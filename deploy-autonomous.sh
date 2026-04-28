#!/bin/bash

# Autonomous Deployment Script
# Deploys meeting automation system with full self-healing capabilities

set -e

echo "🚀 Deploying Autonomous Meeting Automation System"
echo "================================================"

# Check if production env file exists
if [ ! -f ".env.production" ]; then
    echo "❌ Error: .env.production file not found"
    echo "📝 Please copy .env.production.template to .env.production and fill in real values"
    exit 1
fi

# Validate required environment variables
echo "🔍 Validating environment variables..."
required_vars=(
    "NOTION_KEY"
    "ANTHROPIC_API_KEY" 
    "FIREFLY_API_KEY"
    "NOTION_MEETING_REGISTER_DATABASE"
)

missing_vars=()
for var in "${required_vars[@]}"; do
    if ! grep -q "^${var}=" .env.production || grep -q "^${var}=your_" .env.production || grep -q "^${var}=placeholder" .env.production; then
        missing_vars+=("$var")
    fi
done

if [ ${#missing_vars[@]} -gt 0 ]; then
    echo "❌ Missing or placeholder environment variables:"
    printf '  %s\n' "${missing_vars[@]}"
    echo "📝 Please update .env.production with real values"
    exit 1
fi

echo "✅ Environment variables validated"

# Stop existing services
echo "🛑 Stopping existing services..."
docker-compose -f docker-compose.prod.yml down || true

# Build and start services
echo "🔨 Building and starting services..."
docker-compose -f docker-compose.prod.yml up --build -d

# Wait for services to be healthy
echo "⏳ Waiting for services to start..."
sleep 30

# Health checks
echo "🏥 Performing health checks..."
max_attempts=10
attempt=1

while [ $attempt -le $max_attempts ]; do
    echo "  Health check attempt $attempt/$max_attempts"
    
    # Check webhook server
    if curl -f http://localhost:3000/health >/dev/null 2>&1; then
        echo "  ✅ Webhook server healthy"
        webhook_healthy=true
    else
        echo "  ❌ Webhook server not ready"
        webhook_healthy=false
    fi
    
    # Check agent
    if curl -f http://localhost:8000/health >/dev/null 2>&1; then
        echo "  ✅ Agent healthy"
        agent_healthy=true
    else
        echo "  ❌ Agent not ready"
        agent_healthy=false
    fi
    
    if [ "$webhook_healthy" = true ] && [ "$agent_healthy" = true ]; then
        echo "✅ All services healthy!"
        break
    fi
    
    if [ $attempt -eq $max_attempts ]; then
        echo "❌ Services failed to become healthy after $max_attempts attempts"
        echo "📋 Check logs with: docker-compose -f docker-compose.prod.yml logs"
        exit 1
    fi
    
    sleep 10
    attempt=$((attempt + 1))
done

# Test autonomous features
echo "🧪 Testing autonomous features..."

# Test meeting register connection
if curl -f http://localhost:3000/api/meeting-register >/dev/null 2>&1; then
    echo "✅ Meeting Register API accessible"
else
    echo "❌ Meeting Register API not accessible"
    exit 1
fi

# Test retry worker endpoints
if curl -f http://localhost:8000/worker/retry-pending-now >/dev/null 2>&1; then
    echo "✅ Retry worker endpoints accessible"
else
    echo "❌ Retry worker endpoints not accessible"
    exit 1
fi

# Start health monitor
echo "🏥 Starting health monitor..."
node health-monitor.js &
HEALTH_MONITOR_PID=$!
echo "Health monitor started with PID: $HEALTH_MONITOR_PID"

# Display deployment summary
echo ""
echo "🎉 Deployment Complete!"
echo "======================"
echo "📍 Webhook Server: http://localhost:3000"
echo "📍 Agent: http://localhost:8000"
echo "📍 Health Monitor: Running (PID: $HEALTH_MONITOR_PID)"
echo ""
echo "🔧 Autonomous Features Enabled:"
echo "  ✅ Durable retry worker with exponential backoff"
echo "  ✅ Rate limiting protection with 24h cooldown"
echo "  ✅ Max retry attempts (100) to prevent infinite loops"
echo "  ✅ Auto-extraction of external meeting IDs"
echo "  ✅ Health monitoring with auto-recovery"
echo "  ✅ Stale meeting auto-requeue (12 hours)"
echo ""
echo "📊 Monitoring Commands:"
echo "  docker-compose -f docker-compose.prod.yml logs -f"
echo "  curl http://localhost:3000/api/meeting-register | jq '.[] | {title, processingStatus, retryCount}'"
echo "  curl http://localhost:8000/worker/retry-pending-now"
echo ""
echo "🛠️ Manual Controls:"
echo "  Force retry all: curl -X POST http://localhost:8000/worker/retry-pending-now"
echo "  Retry specific: curl -X POST http://localhost:8000/worker/retry-meeting/{external_id}"
echo "  Force rerun: curl -X POST http://localhost:8000/worker/force-rerun/{external_id}"
echo ""
echo "⚠️  To stop services: docker-compose -f docker-compose.prod.yml down"
echo "⚠️  To stop health monitor: kill $HEALTH_MONITOR_PID"
