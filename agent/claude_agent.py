import os
import httpx
import logging
from datetime import datetime
from anthropic import Anthropic
from prompts.system_prompt import SYSTEM_PROMPT
from long_meeting_processor import process_long_meeting, estimate_tokens

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Railway sets PORT=8080 for webhook server
# Use 127.0.0.1 instead of localhost for container compatibility
NOTION_API_BASE = os.getenv("NOTION_API_BASE", "http://127.0.0.1:8080")
logger.info(f"NOTION_API_BASE configured as: {NOTION_API_BASE}")

# Model configuration
SONNET_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-20250514")
HAIKU_MODEL = os.getenv("CLAUDE_HAIKU_MODEL", "claude-haiku-4-5-20251001")

# Long meeting threshold (tokens)
LONG_MEETING_THRESHOLD = int(os.getenv("LONG_MEETING_THRESHOLD_TOKENS", "10000"))

# Cached system prompt for Anthropic prompt caching
CACHED_SYSTEM = [
    {
        "type": "text",
        "text": SYSTEM_PROMPT,
        "cache_control": {"type": "ephemeral"}
    }
]

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
        "description": "Create a task in the Notion Tasks database. Can optionally link to a project. Always include a description and definition of done.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Task name - clear and actionable"},
                "description": {"type": "string", "description": "Task description - context, background, and what needs to be done"},
                "definition_of_done": {"type": "string", "description": "Definition of Done - specific, measurable criteria that must be met for the task to be considered complete (Dan Martell style)"},
                "priority": {"type": "string", "enum": ["High", "Medium", "Low"], "description": "Priority level"},
                "due_date": {"type": "string", "description": "Due date (YYYY-MM-DD)"},
                "status": {"type": "string", "enum": ["To Do", "In Progress", "Done"], "description": "Task status"},
                "project_id": {"type": "string", "description": "Optional project ID to link to"}
            },
            "required": ["name", "description", "definition_of_done"]
        }
    },
    {
        "name": "create_subtask",
        "description": "Create a subtask linked to a parent task. Always include a description and definition of done.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Subtask name - clear and actionable"},
                "description": {"type": "string", "description": "Subtask description - context and what needs to be done"},
                "definition_of_done": {"type": "string", "description": "Definition of Done - specific, measurable criteria that must be met for the subtask to be considered complete"},
                "priority": {"type": "string", "enum": ["High", "Medium", "Low"]},
                "due_date": {"type": "string", "description": "Due date (YYYY-MM-DD)"},
                "parent_task_id": {"type": "string", "description": "Parent task ID"},
                "project_id": {"type": "string", "description": "Project ID"}
            },
            "required": ["name", "parent_task_id", "description", "definition_of_done"]
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
    },
    {
        "name": "create_meeting_agenda",
        "description": "Create a meeting agenda in Notion for upcoming meetings. Use when the transcript discusses a future meeting that needs planning. Follows EOS/Traction L10 meeting format.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Agenda title (e.g., 'L10 Meeting Agenda - Feb 26')"},
                "meeting_date": {"type": "string", "description": "Date of the upcoming meeting (YYYY-MM-DD)"},
                "meeting_type": {"type": "string", "enum": ["L10", "Quarterly", "Annual", "Same Page", "State of Company", "Other"], "description": "Type of meeting"},
                "duration_minutes": {"type": "integer", "description": "Expected duration in minutes (L10=90, Quarterly=480)"},
                "location": {"type": "string", "description": "Meeting location or virtual link"},
                "facilitator": {"type": "string", "description": "Meeting facilitator name"},
                "attendees": {"type": "array", "items": {"type": "string"}, "description": "List of attendees"},
                "rocks_to_review": {"type": "array", "items": {"type": "string"}, "description": "Quarterly rocks/priorities to review"},
                "known_issues": {"type": "array", "items": {"type": "string"}, "description": "Known issues for IDS discussion"},
                "agenda_items": {"type": "array", "items": {"type": "string"}, "description": "Custom agenda items if not standard L10"},
                "project_id": {"type": "string", "description": "Project ID to link to"}
            },
            "required": ["title", "meeting_date", "meeting_type"]
        }
    }
]


async def execute_tool(tool_name: str, tool_input: dict, projects_cache: dict = None) -> str:
    """Execute a tool and return the result as a string.

    Args:
        projects_cache: Session-scoped dict for caching get_projects results.
                        Pass the same dict across calls within one meeting.
    """
    logger.info(f"Connecting to Notion API at: {NOTION_API_BASE}")
    async with httpx.AsyncClient() as client:
        try:
            if tool_name == "get_projects":
                # Return cached result if available
                if projects_cache is not None and "result" in projects_cache:
                    logger.info("Using cached projects data")
                    return projects_cache["result"]

                url = f"{NOTION_API_BASE}/api/projects"
                logger.info(f"GET {url}")
                response = await client.get(url, timeout=30.0)
                projects = response.json()
                if not projects:
                    result_str = "No projects found in the database."
                else:
                    result_str = f"Found {len(projects)} projects:\n" + "\n".join(
                        f"- {p['name']} (ID: {p['id']}, Status: {p.get('status', 'Unknown')})"
                        for p in projects
                    )

                # Cache for this session
                if projects_cache is not None:
                    projects_cache["result"] = result_str

                return result_str

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
                        "definitionOfDone": tool_input.get("definition_of_done"),
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
                        "definitionOfDone": tool_input.get("definition_of_done"),
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

            elif tool_name == "create_meeting_agenda":
                response = await client.post(
                    f"{NOTION_API_BASE}/api/agendas",
                    json={
                        "title": tool_input.get("title"),
                        "meeting_date": tool_input.get("meeting_date"),
                        "meeting_type": tool_input.get("meeting_type"),
                        "duration_minutes": tool_input.get("duration_minutes", 90),
                        "location": tool_input.get("location"),
                        "facilitator": tool_input.get("facilitator"),
                        "attendees": tool_input.get("attendees", []),
                        "rocks_to_review": tool_input.get("rocks_to_review", []),
                        "known_issues": tool_input.get("known_issues", []),
                        "agenda_items": tool_input.get("agenda_items", []),
                        "project_id": tool_input.get("project_id")
                    },
                    timeout=30.0
                )
                result = response.json()
                return f"Created meeting agenda '{tool_input.get('title')}' for {tool_input.get('meeting_date')} (ID: {result.get('id')})"

            else:
                return f"Unknown tool: {tool_name}"

        except Exception as e:
            logger.error(f"Error executing {tool_name}: {str(e)}")
            return f"Error executing {tool_name}: {str(e)}"


def detect_meeting_complexity(transcript_data: dict) -> str:
    """Determine meeting complexity for model selection.

    Returns 'simple' or 'standard'.
    """
    duration = transcript_data.get('duration', 0) or 0
    sentences = transcript_data.get('sentences', [])
    summary = transcript_data.get('summary') or {}
    action_items = summary.get('action_items', [])

    action_count = 0
    if isinstance(action_items, list):
        action_count = len(action_items)
    elif isinstance(action_items, str) and action_items.strip():
        action_count = len(action_items.strip().split('\n'))

    is_short = duration < 0.25  # Less than 15 minutes
    few_sentences = len(sentences) < 50
    few_actions = action_count < 3

    if is_short and few_sentences and few_actions:
        return "simple"
    return "standard"


async def process_meeting_transcript(transcript_data: dict) -> dict:
    """
    Process a meeting transcript using Claude API with optimized token usage.

    Optimizations:
    - Two-pass processing for long meetings (>10k tokens): Haiku extracts, Sonnet creates
    - Prompt caching: system prompt cached across agentic loop iterations
    - Smart model selection: Haiku for simple meetings, Sonnet for standard
    - Token usage tracking with cost calculation
    - Session-scoped tool result caching
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

    # Estimate total transcript tokens
    full_transcript_text = '\n'.join(
        f"**{s.get('speaker_name') or 'Speaker'}**: {s.get('text', '')}"
        for s in sentences
    )
    transcript_tokens = estimate_tokens(full_transcript_text)
    logger.info(f"Transcript size: {transcript_tokens} estimated tokens ({len(sentences)} segments)")

    # Initialize Anthropic client (shared across passes)
    client = Anthropic()

    # Determine processing method based on transcript length
    processing_method = "standard"
    haiku_extraction_cost = 0.0
    haiku_usage = {"input_tokens": 0, "output_tokens": 0}

    if transcript_tokens > LONG_MEETING_THRESHOLD:
        # Two-pass processing: Haiku extracts, then Sonnet creates
        processing_method = "two_pass"
        logger.info(f"Long meeting detected: {transcript_tokens} tokens — using two-pass processing")

        long_result = process_long_meeting(client, sentences)
        haiku_extraction_cost = long_result["haiku_cost"]
        haiku_usage = long_result["haiku_usage"]

        transcript_text = (
            f"This is a LONG meeting (~{transcript_tokens} tokens across "
            f"{long_result['num_chunks']} segments).\n\n"
            f"Below is the comprehensive extraction of ALL action items, decisions, "
            f"and key points from the entire meeting:\n\n"
            f"{long_result['extracted_content']}\n\n"
            f"IMPORTANT: Process ALL items above. Nothing has been truncated."
        )
    else:
        # Standard processing: send transcript directly
        transcript_text = full_transcript_text if full_transcript_text else 'No transcript available'

    # Duration
    duration_raw = transcript_data.get('duration', 0) or 0
    duration_mins = round(duration_raw) if duration_raw >= 1 else f"{int(duration_raw * 60)} seconds"

    # Detect complexity for model selection
    complexity = detect_meeting_complexity(transcript_data)
    if complexity == "simple":
        selected_model = HAIKU_MODEL
        logger.info(f"Meeting complexity: simple — using Haiku ({HAIKU_MODEL})")
    else:
        selected_model = SONNET_MODEL
        logger.info(f"Meeting complexity: standard — using Sonnet ({SONNET_MODEL})")

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
        "summary": None,
        "processing_method": processing_method,
        "model_used": selected_model,
        "complexity": complexity,
        "transcript_tokens": transcript_tokens,
        "token_usage": {
            "total_input": 0,
            "total_output": 0,
            "cache_creation": 0,
            "cache_read": 0,
            "haiku_input": haiku_usage["input_tokens"],
            "haiku_output": haiku_usage["output_tokens"],
        }
    }

    # Session-scoped cache for tool results
    projects_cache = {}

    try:
        messages = [{"role": "user", "content": prompt}]

        # Agentic loop - keep calling until no more tool use
        max_iterations = 10
        for iteration in range(max_iterations):
            logger.info(f"Claude iteration {iteration + 1} ({selected_model})...")

            response = client.messages.create(
                model=selected_model,
                max_tokens=4096,
                system=CACHED_SYSTEM,
                tools=TOOLS,
                messages=messages
            )

            # Track token usage
            usage = response.usage
            results["token_usage"]["total_input"] += usage.input_tokens
            results["token_usage"]["total_output"] += usage.output_tokens

            cache_creation = getattr(usage, 'cache_creation_input_tokens', 0) or 0
            cache_read = getattr(usage, 'cache_read_input_tokens', 0) or 0
            results["token_usage"]["cache_creation"] += cache_creation
            results["token_usage"]["cache_read"] += cache_read

            logger.info(
                f"  Tokens — in: {usage.input_tokens}, out: {usage.output_tokens}, "
                f"cache_write: {cache_creation}, cache_read: {cache_read}"
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
                result = await execute_tool(tool_use.name, tool_use.input, projects_cache)
                logger.info(f"Tool result: {result[:200]}...")
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tool_use.id,
                    "content": result
                })

            messages.append({"role": "user", "content": tool_results})

        results["success"] = True

        # Calculate cost
        tu = results["token_usage"]
        if selected_model == HAIKU_MODEL:
            input_rate, output_rate = 1.0, 5.0
            cache_write_rate = 1.25  # 1.25x input rate
            cache_read_rate = 0.1    # 0.1x input rate
        else:
            input_rate, output_rate = 3.0, 15.0
            cache_write_rate = 3.75
            cache_read_rate = 0.3

        input_cost = tu["total_input"] * input_rate / 1_000_000
        output_cost = tu["total_output"] * output_rate / 1_000_000
        cache_write_cost = tu["cache_creation"] * cache_write_rate / 1_000_000
        cache_read_cost = tu["cache_read"] * cache_read_rate / 1_000_000
        # Haiku extraction pass cost (already calculated)
        total_cost = input_cost + output_cost + cache_write_cost + cache_read_cost + haiku_extraction_cost

        # Estimate what cache_read tokens would have cost without caching
        cache_savings = tu["cache_read"] * (input_rate - cache_read_rate) / 1_000_000

        results["cost_analysis"] = {
            "total_cost_usd": round(total_cost, 4),
            "agentic_loop_cost": round(input_cost + output_cost + cache_write_cost + cache_read_cost, 4),
            "haiku_extraction_cost": round(haiku_extraction_cost, 4),
            "cache_savings_usd": round(cache_savings, 4),
            "model_used": selected_model,
            "processing_method": processing_method,
        }

        logger.info(f"Successfully processed meeting: {transcript_data.get('title')}")
        logger.info(f"  Cost: ${total_cost:.4f} (cache saved: ${cache_savings:.4f})")
        logger.info(f"  Method: {processing_method} | Model: {selected_model} | Complexity: {complexity}")

    except Exception as e:
        results["error"] = str(e)
        logger.error(f"Error processing transcript: {e}")
        import traceback
        traceback.print_exc()

    return results
