# Railway Deployment Checklist

## ✅ **Pre-Deployment Checklist**

### **1. API Keys Required**
Copy these EXACT values to Railway environment variables:

```
ANTHROPIC_API_KEY=sk-ant-xxx... (your real Claude API key)
FIREFLY_API_KEY=fd483b8d-5fa2-46ab-813f-a142bfac5a95
NOTION_KEY=your_real_notion_integration_key
```

### **2. Notion Database IDs**
```
NOTION_PROJECTS_DATABASE_ID=your_projects_db_id
NOTION_TASKS_DATABASE_ID=your_tasks_db_id
NOTION_NOTES_DATABASE_ID=your_notes_db_id
NOTION_MEETING_REGISTER_DATABASE=your_meeting_register_db_id
NOTION_PEOPLE_DATABASE=your_people_db_id
NOTION_DEPARTMENT_DATABASE=your_department_db_id
NOTION_QUARTERLY_ROCKS_DATABASE=your_rocks_db_id
NOTION_PLANNING_CYCLES_DATABASE=your_planning_cycles_db_id
NOTION_SCORE_CARD_METRICS_DATABASE=your_scorecard_db_id
NOTION_EOS_ISSUES_LIST=your_eos_issues_db_id
NOTION_SPEAKER_ALIAS_LIST=your_speaker_aliases_db_id
NOTION_AGENT_CONFIG_DATABASE=your_agent_config_db_id
```

### **3. System Configuration**
```
NODE_ENV=production
FIREFLY_WEBHOOK_SECRET=your_webhook_secret
PORT=3000
CLAUDE_AGENT_URL=http://127.0.0.1:8000
NOTION_API_BASE=http://127.0.0.1:3000
```

## 🚀 **Deployment Steps**

### **Step 1: Push to GitHub**
```bash
git add .
git commit -m "feat: Railway deployment with enhanced logging and immediate processing"
git push origin main
```

### **Step 2: Deploy to Railway**
1. Go to [railway.app](https://railway.app)
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your `meeting-automation` repository
4. Railway will auto-detect Node.js project
5. Click "Deploy"

### **Step 3: Configure Environment Variables**
In Railway dashboard:
1. Click your deployed service
2. Go to "Variables" tab
3. Add ALL variables from checklist above
4. Click "Add Variables" then "Redeploy"

### **Step 4: Configure Fireflies Webhook**
1. Go to Fireflies dashboard → Settings → Webhooks
2. Add webhook URL: `https://your-app-name.railway.app/webhook/fireflies`
3. Set secret: `8c4b28f1dd2e4a618d7a88450e01b4e`
4. Enable "Transcript Completed" events

## 🔍 **Verify Deployment**

### **Health Checks**
```bash
# Check service health
curl https://your-app-name.railway.app/health

# Expected response: {"status": "healthy", "timestamp": "..."}
```

### **Log Monitoring**
In Railway dashboard:
1. Click your service → "Logs"
2. Look for these success messages:
```
🚀 Starting Meeting Automation System on Railway
✅ API keys validated
✅ Webhook server is ready
✅ Agent is ready
🔄 Processing pending meetings immediately
INFO:main:Durable retry worker started
```

### **Test Processing**
```bash
# Force immediate processing of pending meetings
curl -X POST https://your-app-name.railway.app/worker/retry-pending-now

# Check meeting queue
curl https://your-app-name.railway.app/api/meeting-register | jq '.[] | {title, processingStatus}'
```

## 🚨 **Troubleshooting**

### **If Deployment Fails**
1. **Check Railway logs** for specific error messages
2. **Verify API keys** are real (not placeholders)
3. **Check environment variables** are all set

### **If Meetings Don't Process**
1. **Check logs** for rate limiting errors
2. **Manual retry**: `curl -X POST https://your-app-name.railway.app/worker/retry-pending-now`
3. **Check Notion** for database connectivity

### **Common Issues**
```
❌ ERROR: ANTHROPIC_API_KEY is missing or placeholder
# Fix: Set real ANTHROPIC_API_KEY in Railway variables

❌ ERROR: FIREFLY_API_KEY is missing or placeholder
# Fix: Set real FIREFLY_API_KEY in Railway variables

❌ ERROR: NOTION_KEY is missing or placeholder
# Fix: Set real NOTION_KEY in Railway variables
```

## 📊 **Expected Timeline**

- **Deployment**: 2-3 minutes
- **Service Startup**: 60 seconds
- **First Meeting Processing**: 1-2 minutes
- **All Pending Meetings**: 5-10 minutes

## 🎯 **Success Indicators**

✅ Railway shows "Running" status
✅ Health check returns 200 OK
✅ Logs show "API keys validated"
✅ Immediate retry triggered on startup
✅ Meeting notes appear in Notion
✅ Webhook receives Fireflies events

---

**Once deployed, your customer will get meeting notes immediately with full visibility into processing status!**
