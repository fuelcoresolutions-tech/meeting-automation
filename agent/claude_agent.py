import os
import httpx
import logging
from datetime import datetime
from anthropic import Anthropic
from prompts.system_prompt import SYSTEM_PROMPT

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Railway sets PORT=8080 for webhook server, default to that
NOTION_API_BASE = os.getenv("NOTION_API_BASE", "http://localhost:8080")

# Define tools for Claude API (function calling)
TOOLS = [
    {
        "name": "get_projects",
        "description": "Retrieve all existing projects from Notion. Use this first to find relevant projects for linking tasks and notes.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": []
        }
    },
    {
        "name": "create_meeting_note",
        "description": "Create a meeting note in the Notion Notes database with overview, action items, and key points.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Title of the meeting note"},
                "date": {"type": "string", "description": "Date of the meeting (YYYY-MM-DD)"},
                "duration_seconds": {"type": "integer", "description": "Duration in seconds"},
                "overview": {"type": "string", "description": "Meeting overview/summary"},
                "action_items": {"type": "array", "items": {"type": "string"}, "description": "List of action items"},
                "key_points": {"type": "array", "items": {"type": "string"}, "description": "Key discussion points"},
                "project_id": {"type": "string", "description": "Optional project ID to link to"}
            },
            "required": ["title", "date", "overview"]
        }
    },
    {
        "name": "create_task",
        "description": "Create a task in the Notion Tasks database. Can optionally link to a project.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Task name"},
                "description": {"type": "string", "description": "Task description"},
                "priority": {"type": "string", "enum": ["High", "Medium", "Low"], "description": "Priority level"},
                "due_date": {"type": "string", "description": "Due date (YYYY-MM-DD)"},
                "status": {"type": "string", "enum": ["To Do", "In Progress", "Done"], "description": "Task status"},
                "project_id": {"type": "string", "description": "Optional project ID to link to"}
            },
            "required": ["name"]
        }
    },
    {
        "name": "create_subtask",
        "description": "Create a subtask linked to a parent task.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Subtask name"},
                "description": {"type": "string", "description": "Subtask description"},
                "priority": {"type": "string", "enum": ["High", "Medium", "Low"]},
                "due_date": {"type": "string", "description": "Due date (YYYY-MM-DD)"},
                "parent_task_id": {"type": "string", "description": "Parent task ID"},
                "project_id": {"type": "string", "description": "Project ID"}
            },
            "required": ["name", "parent_task_id"]
        }
    },
    {
        "name": "create_project",
        "description": "Create a new project in Notion. Only use when multiple related tasks don't fit any existing project.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Project name"},
                "description": {"type": "string", "description": "Project description"},
                "status": {"type": "string", "enum": ["Planned", "In Progress", "Completed"]}
            },
            "required": ["name"]
        }
    }
]


async def execute_tool(tool_name: str, tool_input: dict) -> str:
    """Execute a tool and return the result as a string."""
    async with httpx.AsyncClient() as client:
        try:
            if tool_name == "get_projects":
                response = await client.get(f"{NOTION_API_BASE}/api/projects", timeout=30.0)
                projects = response.json()
                if not projects:
                    return "No projects found in the database."
                return f"Found {len(projects)} projects:\n" + "\n".join(
                    f"- {p['name']} (ID: {p['id']}, Status: {p.get('status', 'Unknown')})"
                    for p in projects
                )

            elif tool_name == "create_meeting_note":
                response = await client.post(
                    f"{NOTION_API_BASE}/api/notes",
                    json={
                        "title": tool_input.get("title"),
                        "date": tool_input.get("date"),
                        "duration_seconds": tool_input.get("duration_seconds"),
                        "overview": tool_input.get("overview"),
                        "action_items": tool_input.get("action_items", []),
                        "key_points": tool_input.get("key_points", []),
                        "project_id": tool_input.get("project_id")
                    },
                    timeout=30.0
                )
                result = response.json()
                return f"Created meeting note '{tool_input.get('title')}' with ID: {result.get('id')}"

            elif tool_name == "create_task":
                response = await client.post(
                    f"{NOTION_API_BASE}/api/tasks",
                    json={
                        "name": tool_input.get("name"),
                        "description": tool_input.get("description"),
                        "priority": tool_input.get("priority", "Medium"),
                        "dueDate": tool_input.get("due_date"),
                        "status": tool_input.get("status", "To Do"),
                        "projectId": tool_input.get("project_id")
                    },
                    timeout=30.0
                )
                result = response.json()
                return f"Created task '{tool_input.get('name')}' (ID: {result.get('id')})"

            elif tool_name == "create_subtask":
                response = await client.post(
                    f"{NOTION_API_BASE}/api/tasks",
                    json={
                        "name": tool_input.get("name"),
                        "description": tool_input.get("description"),
                        "priority": tool_input.get("priority", "Medium"),
                        "dueDate": tool_input.get("due_date"),
                        "status": "To Do",
                        "parentTaskId": tool_input.get("parent_task_id"),
                        "projectId": tool_input.get("project_id")
                    },
                    timeout=30.0
                )
                result = response.json()
                return f"Created subtask '{tool_input.get('name')}' (ID: {result.get('id')})"

            elif tool_name == "create_project":
                response = await client.post(
                    f"{NOTION_API_BASE}/api/projects",
                    json={
                        "name": tool_input.get("name"),
                        "description": tool_input.get("description"),
                        "status": tool_input.get("status", "Planned")
                    },
                    timeout=30.0
                )
                result = response.json()
                return f"Created project '{tool_input.get('name')}' with ID: {result.get('id')}"

            else:
                return f"Unknown tool: {tool_name}"

        except Exception as e:
            logger.error(f"Error executing {tool_name}: {str(e)}")
            return f"Error executing {tool_name}: {str(e)}"


async def process_meeting_transcript(transcript_data: dict) -> dict:
    """
    Process a meeting transcript using Claude API directly.
    """
    # Parse the meeting date
    date_str = transcript_data.get('date', '')
    try:
        if date_str:
            meeting_date = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
            formatted_date = meeting_date.strftime('%Y-%m-%d')
        else:
            formatted_date = datetime.now().strftime('%Y-%m-%d')
    except (ValueError, AttributeError):
        formatted_date = datetime.now().strftime('%Y-%m-%d')

    # Get summary data
    summary = transcript_data.get('summary') or {}
    overview = summary.get('overview', 'No overview available')
    action_items = summary.get('action_items', [])
    key_points = summary.get('shorthand_bullet', [])
    sentences = transcript_data.get('sentences', [])

    # Format action items (handle both string and list)
    if isinstance(action_items, str):
        action_items_text = action_items if action_items.strip() else 'No action items identified'
    elif isinstance(action_items, list) and action_items:
        action_items_text = '\n'.join(f"- {item}" for item in action_items)
    else:
        action_items_text = 'No action items identified'

    # Format key points (handle both string and list)
    if isinstance(key_points, str):
        key_points_text = key_points if key_points.strip() else 'No key points available'
    elif isinstance(key_points, list) and key_points:
        key_points_text = '\n'.join(f"- {point}" for point in key_points)
    else:
        key_points_text = 'No key points available'

    # Format transcript (limit to ~10k tokens = ~40k chars)
    MAX_TRANSCRIPT_CHARS = 40000
    transcript_lines = []
    total_chars = 0
    truncated = False

    for s in sentences:
        speaker = s.get('speaker_name') or 'Speaker'
        text = s.get('text', '')
        line = f"**{speaker}**: {text}"
        if total_chars + len(line) > MAX_TRANSCRIPT_CHARS:
            truncated = True
            break
        transcript_lines.append(line)
        total_chars += len(line) + 1

    transcript_text = '\n'.join(transcript_lines) if transcript_lines else 'No transcript available'
    if truncated:
        transcript_text += f'\n\n... (truncated - {len(transcript_lines)} of {len(sentences)} segments)'

    # Duration
    duration_raw = transcript_data.get('duration', 0) or 0
    duration_mins = round(duration_raw) if duration_raw >= 1 else f"{int(duration_raw * 60)} seconds"

    # Build prompt
    prompt = f"""Process this meeting transcript and create Notion entries:

## Meeting Information
- **Title**: {transcript_data.get('title', 'Untitled Meeting')}
- **Date**: {formatted_date}
- **Duration**: {duration_mins} minutes

## Meeting Overview
{overview}

## Action Items (from Fireflies)
{action_items_text}

## Key Discussion Points
{key_points_text}

## Full Transcript
{transcript_text}

---

**Instructions:**
1. First, call get_projects() to see existing projects
2. Create a meeting note with the overview and link it to the most relevant project
3. Analyze action items AND transcript to extract all tasks
4. Group related tasks under parent tasks where appropriate
5. Set priorities and deadlines based on context
6. Provide a summary of what was created
"""

    results = {
        "meeting_id": transcript_data.get('id'),
        "title": transcript_data.get('title'),
        "messages": [],
        "success": False,
        "error": None,
        "summary": None
    }

    try:
        client = Anthropic()
        messages = [{"role": "user", "content": prompt}]

        # Agentic loop - keep calling until no more tool use
        max_iterations = 10
        for iteration in range(max_iterations):
            logger.info(f"Claude iteration {iteration + 1}...")

            response = client.messages.create(
                model=os.getenv("CLAUDE_MODEL", "claude-sonnet-4-20250514"),
                max_tokens=4096,
                system=SYSTEM_PROMPT,
                tools=TOOLS,
                messages=messages
            )

            # Process response
            assistant_content = response.content
            messages.append({"role": "assistant", "content": assistant_content})

            # Check for tool use
            tool_uses = [block for block in assistant_content if block.type == "tool_use"]

            if not tool_uses:
                # No more tools - extract final text
                for block in assistant_content:
                    if hasattr(block, 'text'):
                        results["summary"] = block.text
                        results["messages"].append(block.text)
                break

            # Execute tools and add results
            tool_results = []
            for tool_use in tool_uses:
                logger.info(f"Executing tool: {tool_use.name} with input: {tool_use.input}")
                result = await execute_tool(tool_use.name, tool_use.input)
                logger.info(f"Tool result: {result[:200]}...")
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tool_use.id,
                    "content": result
                })

            messages.append({"role": "user", "content": tool_results})

        results["success"] = True
        logger.info(f"Successfully processed meeting: {transcript_data.get('title')}")

    except Exception as e:
        results["error"] = str(e)
        logger.error(f"Error processing transcript: {e}")
        import traceback
        traceback.print_exc()

    return results
