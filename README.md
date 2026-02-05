# Meeting Automation with Claude Agent

Intelligent meeting processing system that integrates Fireflies.ai transcripts with Claude AI analysis and automated Notion task creation.

## 🚀 Features

- **Fireflies.ai Integration** - Automatically receives meeting transcripts via webhooks
- **Claude AI Processing** - Intelligent analysis of transcripts to extract action items, tasks, and priorities
- **Notion Automation** - Creates organized notes, tasks, and projects in your Notion workspace
- **Priority Classification** - Automatically classifies tasks as High/Medium/Low priority
- **Deadline Inference** - Extracts and sets deadlines from meeting context
- **Task Grouping** - Creates parent tasks for related action items

## 🏗️ Architecture

```
Fireflies.ai → Webhook Server → Claude Agent → Notion API
     ↓              ↓              ↓           ↓
  Transcript    Express.js     Python      Task/Note
  Processing    Webhook        FastAPI     Creation
                Endpoint       Server
```

## 📁 Project Structure

```
fuelcore/
├── webhook-server.js          # Main Express server for Fireflies webhooks
├── notion-api-bridge.js       # API endpoints for Claude agent to use
├── fireflies.js              # Fireflies API integration
├── notion.js                 # Notion API client functions
├── agent/                     # Python Claude Agent
│   ├── main.py               # FastAPI server
│   ├── claude_agent.py       # Claude Agent SDK integration
│   ├── tools/
│   │   └── notion_tools.py   # MCP tool definitions
│   ├── prompts/
│   │   └── system_prompt.py  # Claude system instructions
│   └── requirements.txt      # Python dependencies
├── package.json              # Node.js dependencies and scripts
├── railway.json              # Railway deployment config
├── nixpacks.toml            # Build configuration
└── Procfile                 # Process configuration
```

## 🛠️ Local Development

### Prerequisites

- Node.js 18+
- Python 3.11+
- Notion integration with database sharing
- Fireflies.ai API key
- Claude API key

### Setup

1. **Clone and install dependencies:**
```bash
git clone https://github.com/fuelcoresolutions-tech/meeting-automation.git
cd meeting-automation
npm install
cd agent && pip install -r requirements.txt
```

2. **Configure environment variables:**
```bash
cp .env.example .env
# Edit .env with your API keys and database IDs
```

3. **Start development servers:**
```bash
npm run dev
```

This starts both the webhook server (port 3000) and Claude agent (port 8000) concurrently.

## 🚀 Deployment

### Deploy to Railway

1. **Install Railway CLI (if not already):**
```bash
npm install -g @railway/cli
```

2. **Login to Railway:**
```bash
railway login
```

3. **Initialize project:**
```bash
railway init
```

4. **Add environment variables in Railway Dashboard:**
   - Go to your project → Variables → Add all from `.env`

5. **Deploy:**
```bash
railway up
```

> **Important:** After deployment, Railway will give you a URL like `https://fuelcore-production.up.railway.app`. Update Fireflies webhook to: `https://fuelcore-production.up.railway.app/webhook/fireflies`

### Alternative: Deploy to Render.com

1. **Push code to GitHub:**
```bash
git add .
git commit -m "Initial commit - Fireflies webhook with Claude Agent"
git remote add origin https://github.com/YOUR_USERNAME/meeting-automation.git
git push -u origin main
```

2. **Go to render.com → New Web Service**
3. **Connect your GitHub repo**
4. **Configure:**
   - **Build Command:** `npm install && cd agent && pip install -r requirements.txt`
   - **Start Command:** `(cd agent && python -m uvicorn main:app --host 127.0.0.1 --port 8000 &) && sleep 2 && node webhook-server.js`
5. **Add environment variables from `.env`**
6. **Deploy**

## 🔧 Configure Fireflies Webhook

| Step | Action |
|------|--------|
| 1 | Go to app.fireflies.ai/settings |
| 2 | Click Developer settings tab |
| 3 | In Webhook URL field, enter: `https://YOUR-DEPLOYED-URL/webhook/fireflies` |
| 4 | (Optional) Set a Webhook Secret and add to your environment variables |
| 5 | Click Save |

## 🧪 Test the Integration

### Method 1: Upload a test recording

1. Go to app.fireflies.ai/upload
2. Upload any audio/video file
3. Wait for transcription to complete
4. Check your Notion for new entries!

### Method 2: Manual test endpoint

```bash
curl -X POST https://YOUR-DEPLOYED-URL/test/process-meeting \
  -H "Content-Type: application/json" \
  -d '{"meetingId": "YOUR_FIREFLIES_MEETING_ID"}'
```

## ✅ Verify It's Working

After a meeting is transcribed, check:

- **Notion Notes database** - New meeting note with overview & action items
- **Notion Tasks database** - Tasks extracted from the meeting with priorities & deadlines
- **Server logs** - Processing messages in Railway/Render dashboard

## 🚀 Quick Test with Ngrok (Before Deploying)

```bash
# Terminal 1
npm run dev

# Terminal 2
ngrok http 3000
# Copy the https URL and add to Fireflies webhook settings
```

## 📋 Environment Variables

Required environment variables in `.env`:

```env
# Notion Configuration
NOTION_KEY=your_notion_integration_token
NOTION_PROJECTS_DATABASE_ID=your_projects_database_id
NOTION_TASKS_DATABASE_ID=your_tasks_database_id
NOTION_NOTES_DATABASE_ID=your_notes_database_id
NOTION_PAGE_ID=your_ultimate_brain_page_id

# Fireflies Configuration
FIREFLY_API_KEY=your_fireflies_api_key
FIREFLY_WEBHOOK_SECRET=optional_webhook_secret

# Claude Agent Configuration
ANTHROPIC_API_KEY=your_claude_api_key
CLAUDE_AGENT_URL=http://localhost:8000
NOTION_API_BASE=http://localhost:3000
CLAUDE_MODEL=claude-sonnet-4-20250514

# Server Configuration
PORT=3000
```

## 🔍 Notion Database Setup

1. **Share databases with your Notion integration:**
   - Open your main "Tasks" database in Notion
   - Click "Share" → "Invite" → Search for your integration name
   - Grant "Full access" permissions
   - Repeat for "Projects" and "Notes" databases

2. **Database structure requirements:**
   - **Tasks database** should have: Name (title), Status, Priority, Due Date properties
   - **Projects database** should have: Name (title), Status, Description properties
   - **Notes database** should have: Name (title), Date, Overview properties

## 🤖 Claude Agent Features

The Claude Agent automatically:

- **Priority Classification:**
  - HIGH: "urgent", "ASAP", "critical", "blocker", "today"
  - MEDIUM: "this week", "soon", "important"
  - LOW: "eventually", "nice to have", "backlog"

- **Deadline Inference:**
  - "Tomorrow" → meeting_date + 1 day
  - "This week" → Friday of meeting week
  - "ASAP" → meeting_date + 2 business days
  - No timeline → meeting_date + 7 days (default)

- **Task Grouping:** Creates parent task when 3+ related tasks exist

## 🐛 Troubleshooting

### Common Issues

1. **"Could not find database" errors:**
   - Ensure databases are shared with your Notion integration
   - Check database IDs in environment variables

2. **Webhook not receiving data:**
   - Verify Fireflies webhook URL is correct
   - Check webhook secret matches (if configured)

3. **Claude Agent not processing:**
   - Ensure ANTHROPIC_API_KEY is valid
   - Check agent server logs for errors

### Logs and Debugging

- **Railway:** View logs in Railway dashboard
- **Render:** View logs in Render dashboard
- **Local:** Check console output for both servers

## 📄 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📞 Support

For issues and questions:
- Create an issue in this repository
- Check the troubleshooting section above
- Review server logs for error details
