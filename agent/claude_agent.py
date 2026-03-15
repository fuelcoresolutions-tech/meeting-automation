import os
import httpx
import logging
from datetime import datetime
from anthropic import Anthropic
from prompts.system_prompt import build_system_prompt
from long_meeting_processor import process_long_meeting, estimate_tokens
from context_loader import load_context_for_prompt
from output_validator import OutputValidator

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Railway sets PORT=8080 for webhook server
# Use 127.0.0.1 instead of localhost for container compatibility
NOTION_API_BASE = os.getenv("NOTION_API_BASE", "http://127.0.0.1:8080")
logger.info(f"NOTION_API_BASE configured as: {NOTION_API_BASE}")

# Model configuration
SONNET_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-20250514")

# Long meeting threshold (tokens)
LONG_MEETING_THRESHOLD = int(os.getenv("LONG_MEETING_THRESHOLD_TOKENS", "10000"))

# Define tools for Claude API (function calling)
TOOLS = [
    {
        "name": "get_projects",
        "description": "Retrieve all existing projects from Notion including descriptions, keywords, and client info. Use this first to find relevant projects for linking tasks and notes. Use keywords and descriptions to detect cross-project topics — create separate meeting notes per relevant project when 2+ transcript topics match a project's keywords.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": []
        }
    },
    {
        "name": "create_meeting_note",
        "description": "Create a structured meeting note in Notion. ALWAYS populate the structured section fields (meeting_info, segue, ids_issues, conclude_todos, cascading_messages, meeting_rating, etc.) for ALL meeting types. Use overview/action_items/key_points ONLY as fallback if no structured data can be extracted.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Title following strict format (e.g., 'L10 Meeting Notes — Feb 08, 2026')"},
                "date": {"type": "string", "description": "Date of the meeting (YYYY-MM-DD)"},
                "duration_seconds": {"type": "integer", "description": "Duration in seconds"},
                "meeting_type": {
                    "type": "string",
                    "enum": ["L10", "Quarterly", "Annual", "Same Page", "State of Company", "Quarterly Conversation", "Other", "General"],
                    "description": "Detected meeting type from transcript"
                },
                "project_id": {"type": "string", "description": "Primary project ID (use project_ids instead when meeting spans multiple projects)"},
                "project_ids": {"type": "array", "items": {"type": "string"}, "description": "ALL relevant project IDs for this meeting. Use when transcript covers topics from multiple projects (e.g., Fuel Core + Lexor Foundation). Creates ONE note linked to all projects — do NOT create duplicate notes."},
                "meeting_info": {
                    "type": "object",
                    "description": "Meeting metadata (date, time, location, facilitator, scribe, attendees)",
                    "properties": {
                        "time": {"type": "string", "description": "Meeting time range (e.g., '9:00 AM - 10:30 AM')"},
                        "location": {"type": "string"},
                        "facilitator": {"type": "string"},
                        "scribe": {"type": "string"},
                        "attendees": {"type": "array", "items": {"type": "string"}}
                    }
                },
                "segue": {
                    "type": "array",
                    "description": "Segue — personal/professional good news per person",
                    "items": {
                        "type": "object",
                        "properties": {
                            "person": {"type": "string"},
                            "personal": {"type": "string"},
                            "professional": {"type": "string"}
                        },
                        "required": ["person"]
                    }
                },
                "scorecard": {
                    "type": "array",
                    "description": "Scorecard metrics review",
                    "items": {
                        "type": "object",
                        "properties": {
                            "metric": {"type": "string"},
                            "owner": {"type": "string"},
                            "goal": {"type": "string"},
                            "actual": {"type": "string"},
                            "status": {"type": "string", "enum": ["On Track", "Off Track"]}
                        },
                        "required": ["metric", "owner", "status"]
                    }
                },
                "rock_review": {
                    "type": "array",
                    "description": "Quarterly rocks/priorities status",
                    "items": {
                        "type": "object",
                        "properties": {
                            "rock": {"type": "string"},
                            "owner": {"type": "string"},
                            "due": {"type": "string"},
                            "status": {"type": "string", "enum": ["On Track", "Off Track"]}
                        },
                        "required": ["rock", "owner", "status"]
                    }
                },
                "todo_review": {
                    "type": "object",
                    "description": "To-Do list review from previous meeting with completion rate",
                    "properties": {
                        "items": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "todo": {"type": "string"},
                                    "owner": {"type": "string"},
                                    "status": {"type": "string", "enum": ["Done", "Not Done"]}
                                },
                                "required": ["todo", "owner", "status"]
                            }
                        },
                        "completion_rate": {"type": "string", "description": "e.g., '85% (6/7 completed)'"}
                    }
                },
                "headlines": {
                    "type": "array",
                    "description": "Customer/Employee headlines",
                    "items": {
                        "type": "object",
                        "properties": {
                            "type": {"type": "string", "enum": ["Customer", "Employee"]},
                            "headline": {"type": "string"},
                            "dropped_to_issues": {"type": "boolean"}
                        },
                        "required": ["headline"]
                    }
                },
                "ids_issues": {
                    "type": "array",
                    "description": "IDS issues — each with issue statement, root cause, discussion summary, and solution",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string", "description": "Short issue title"},
                            "issue": {"type": "string", "description": "Clear problem statement"},
                            "root_cause": {"type": "string"},
                            "discussion_summary": {"type": "string"},
                            "solution": {"type": "string"}
                        },
                        "required": ["title", "issue", "solution"]
                    }
                },
                "conclude_todos": {
                    "type": "array",
                    "description": "New To-Dos from the Conclude section",
                    "items": {
                        "type": "object",
                        "properties": {
                            "todo": {"type": "string"},
                            "owner": {"type": "string"},
                            "due_date": {"type": "string"},
                            "department": {"type": "string"}
                        },
                        "required": ["todo", "owner", "due_date"]
                    }
                },
                "cascading_messages": {
                    "type": "array",
                    "description": "Messages to cascade to the organization",
                    "items": {
                        "type": "object",
                        "properties": {
                            "message": {"type": "string"},
                            "who_communicates": {"type": "string"},
                            "to_whom": {"type": "string"}
                        },
                        "required": ["message"]
                    }
                },
                "next_meeting": {
                    "type": "object",
                    "description": "Next meeting details",
                    "properties": {
                        "date": {"type": "string"},
                        "time": {"type": "string"},
                        "location": {"type": "string"}
                    }
                },
                "meeting_rating": {
                    "type": "object",
                    "description": "Meeting ratings from attendees with average",
                    "properties": {
                        "ratings": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "attendee": {"type": "string"},
                                    "rating": {"type": "number"}
                                },
                                "required": ["attendee", "rating"]
                            }
                        },
                        "average": {"type": "number"}
                    }
                },
                "overview": {"type": "string", "description": "Meeting overview (for General/non-EOS meetings)"},
                "action_items": {"type": "array", "items": {"type": "string"}, "description": "Action items list (for General/non-EOS meetings)"},
                "key_points": {"type": "array", "items": {"type": "string"}, "description": "Key discussion points (for General/non-EOS meetings)"},
                "people_ids": {"type": "array", "items": {"type": "string"}, "description": "People IDs from KNOWN PEOPLE — ALL attendees of the meeting. ALWAYS populate this."},
                "department_ids": {"type": "array", "items": {"type": "string"}, "description": "Department IDs from KNOWN DEPARTMENTS relevant to this meeting"},
                "project_ids": {"type": "array", "items": {"type": "string"}, "description": "Additional project IDs if this meeting spans multiple projects. When cross-project topics are detected (transcript topics match keywords of multiple projects), call create_meeting_note once per relevant project with the same content but different project_id values."},
                "organization_name": {"type": "string", "description": "Company/organization name for the meeting header. Determine from the project this meeting belongs to. E.g. 'FUEL CORE SOLUTIONS' for internal Fuel Core meetings, 'LEXOR FOUNDATION' for Lexor Foundation meetings. ALWAYS pass this — never omit it."}
            },
            "required": ["title", "date", "meeting_type", "people_ids"]
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
                "priority": {"type": "string", "enum": ["High", "Medium", "Low"], "description": "Priority level (status type)"},
                "due_date": {"type": "string", "description": "Due date (YYYY-MM-DD)"},
                "status": {"type": "string", "enum": ["To Do", "Doing", "Done"], "description": "Task status. MUST be one of: To Do, Doing, Done. NOT 'In Progress'."},
                "project_id": {"type": "string", "description": "Project ID from KNOWN PROJECTS — REQUIRED"},
                "department_ids": {"type": "array", "items": {"type": "string"}, "description": "Department IDs from KNOWN DEPARTMENTS to link this task to"},
                "people_ids": {"type": "array", "items": {"type": "string"}, "description": "People IDs from KNOWN PEOPLE — the task owner/assignee. ALWAYS populate this — if no specific owner is mentioned, assign to the person who raised the topic or the meeting facilitator."}
            },
            "required": ["name", "description", "definition_of_done", "project_id", "people_ids"]
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
                "definition_of_done": {"type": "string", "description": "Definition of Done - specific, measurable criteria"},
                "priority": {"type": "string", "enum": ["High", "Medium", "Low"]},
                "due_date": {"type": "string", "description": "Due date (YYYY-MM-DD)"},
                "parent_task_id": {"type": "string", "description": "Parent task ID"},
                "project_id": {"type": "string", "description": "Project ID from KNOWN PROJECTS"},
                "department_ids": {"type": "array", "items": {"type": "string"}, "description": "Department IDs"},
                "people_ids": {"type": "array", "items": {"type": "string"}, "description": "People IDs"}
            },
            "required": ["name", "parent_task_id", "description", "definition_of_done"]
        }
    },
    {
        "name": "create_meeting_register",
        "description": "Create a Meeting Register entry in Notion to track meeting processing. Do this after creating the meeting note.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Meeting title"},
                "meetingDate": {"type": "string", "description": "Meeting date (YYYY-MM-DD)"},
                "meetingFormat": {"type": "string", "enum": ["Virtual", "In-Person", "Hybrid"]},
                "meetingTypes": {"type": "array", "items": {"type": "string", "enum": ["L10", "Quartely", "Annual", "Same Page", "State Of Company", "Ad Hoc"]}},
                "processingStatus": {"type": "string", "enum": ["Pending", "Processing", "Completed", "Failed"]},
                "transcriptSource": {"type": "string", "description": "Fireflies transcript URL"},
                "confidenceNotes": {"type": "string", "description": "Any low-confidence decisions"},
                "facilitatorIds": {"type": "array", "items": {"type": "string"}, "description": "People IDs for facilitator"},
                "attendeeIds": {"type": "array", "items": {"type": "string"}, "description": "People IDs for attendees"},
                "departmentIds": {"type": "array", "items": {"type": "string"}, "description": "Department IDs"},
                "meetingNoteIds": {"type": "array", "items": {"type": "string"}, "description": "Meeting Note page IDs"}
            },
            "required": ["title", "meetingDate"]
        }
    },
    {
        "name": "create_eos_issue",
        "description": "Create an EOS Issue in Notion for every IDS issue discussed (resolved or unresolved). Fill ALL fields with maximum detail — never leave optional fields empty if the information exists in the transcript.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Concise, specific issue title (5–10 words) using real nouns from the discussion. E.g., 'Inventory stockout risk — only 20 units left'. Never use generic labels."},
                "issueDescription": {"type": "string", "description": "REQUIRED. Multi-paragraph rich description containing ALL four components:\n1. Problem Statement — what is the issue and why it matters to the business\n2. Root Cause — the underlying reason identified in the discussion\n3. Discussion Summary — 3–5 sentences capturing WHO said WHAT, specific numbers, proposals, and trade-offs discussed\n4. Solution / Status — use EOS language: 'Change it – [specific action]', 'End it – [what stops]', or 'Live with it – [what is accepted]'. If unresolved: 'Carry forward – needs further IDS.'"},
                "priority": {"type": "string", "enum": ["Low", "Medium", "High"], "description": "High = urgent blocker or Rock-level impact with deadline < 3 days. Medium = important but not time-critical. Low = nice-to-have or backlog."},
                "isResolved": {"type": "boolean", "description": "true only if a solution was fully agreed upon in this meeting. false if still open or partially discussed."},
                "resolutionNotes": {"type": "string", "description": "ALWAYS populate. If resolved: summarise what was decided, who owns the action, and by when. If unresolved: 'Carry forward — needs further IDS at next L10. Key open questions: [list them]'"},
                "raisedByIds": {"type": "array", "items": {"type": "string"}, "description": "REQUIRED. People IDs (from KNOWN PEOPLE) of who raised or owns the issue. Always populate this."},
                "departmentIds": {"type": "array", "items": {"type": "string"}, "description": "REQUIRED. Department IDs (from KNOWN DEPARTMENTS) relevant to this issue. Always populate this."},
                "projectIds": {"type": "array", "items": {"type": "string"}, "description": "REQUIRED. Project IDs (from KNOWN PROJECTS) this issue belongs to. Always populate this."},
                "rockIds": {"type": "array", "items": {"type": "string"}, "description": "Quarterly Rock IDs (from KNOWN ROCKS) if this issue is directly tied to a Rock. Populate whenever applicable."},
                "sourceMeetingIds": {"type": "array", "items": {"type": "string"}, "description": "REQUIRED. The meeting note page ID created earlier in this session. Always link the issue back to its source meeting."}
            },
            "required": ["title", "issueDescription", "resolutionNotes", "raisedByIds", "departmentIds", "projectIds", "sourceMeetingIds"]
        }
    },
    {
        "name": "create_speaker_alias",
        "description": "Create a Speaker Alias mapping in Notion. Use when a new speaker-to-person mapping is discovered.",
        "input_schema": {
            "type": "object",
            "properties": {
                "alias": {"type": "string", "description": "How Fireflies labels the speaker"},
                "personIds": {"type": "array", "items": {"type": "string"}, "description": "People IDs for the resolved person"},
                "source": {"type": "string", "description": "Source of the alias (e.g., 'Fireflies')"},
                "confidence": {"type": "number", "description": "Confidence 0-1"},
                "notes": {"type": "string", "description": "Why this mapping was made"}
            },
            "required": ["alias"]
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
                "project_id": {"type": "string", "description": "Project ID to link to"},
                "organization_name": {"type": "string", "description": "Company/organization name for the agenda header. Use the same org name as the matching meeting note. E.g. 'FUEL CORE SOLUTIONS' for Fuel Core meetings, 'LEXOR FOUNDATION' for Lexor Foundation meetings. ALWAYS pass this."}
            },
            "required": ["title", "meeting_date", "meeting_type"]
        }
    }
]


async def execute_tool(tool_name: str, tool_input: dict, projects_cache: dict = None,
                       validator: OutputValidator = None, context_section: str = "") -> str:
    """Execute a tool and return the result as a string.

    Args:
        projects_cache: Session-scoped dict for caching get_projects results.
        validator: OutputValidator instance for cross-checking write operations.
        context_section: Formatted Notion context for the validator.
    """
    # ── Validate write operations before executing ──
    write_tools = {"create_meeting_note", "create_task", "create_subtask",
                   "create_meeting_register", "create_eos_issue",
                   "create_speaker_alias", "create_meeting_agenda"}
    if validator and tool_name in write_tools and context_section:
        logger.info(f"  Validating {tool_name} payload...")
        validation = await validator.validate(tool_name, tool_input, context_section)
        if not validation["passed"]:
            logger.warning(f"  VALIDATOR REJECTED {tool_name} — returning error to agent")
            return f"VALIDATION FAILED for {tool_name}: The payload has critical errors. Corrections needed: {validation['corrections']}"
        if validation["corrections"]:
            logger.info(f"  Validator applied {len(validation['corrections'])} corrections")
        tool_input = validation["payload"]

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
                    def _fmt_project(p):
                        keywords = ", ".join(p.get("keywords", [])) or "—"
                        client = p.get("client", "") or "—"
                        desc = (p.get("description", "") or "")[:120]
                        desc_str = (desc + "...") if len(p.get("description", "") or "") > 120 else desc or "—"
                        return (
                            f"- {p['name']} (ID: {p['id']}, Status: {p.get('status', 'Unknown')}, "
                            f"Client: {client}, Keywords: [{keywords}], Description: {desc_str})"
                        )
                    result_str = f"Found {len(projects)} projects:\n" + "\n".join(
                        _fmt_project(p) for p in projects
                    )

                # Cache for this session
                if projects_cache is not None:
                    projects_cache["result"] = result_str

                return result_str

            elif tool_name == "create_meeting_note":
                # Pass people_ids and department_ids alongside the rest of the payload
                payload = dict(tool_input)
                response = await client.post(
                    f"{NOTION_API_BASE}/api/notes",
                    json=payload,
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
                        "projectId": tool_input.get("project_id"),
                        "departmentIds": tool_input.get("department_ids", []),
                        "peopleIds": tool_input.get("people_ids", []),
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
                        "projectId": tool_input.get("project_id"),
                        "departmentIds": tool_input.get("department_ids", []),
                        "peopleIds": tool_input.get("people_ids", []),
                    },
                    timeout=30.0
                )
                result = response.json()
                return f"Created subtask '{tool_input.get('name')}' (ID: {result.get('id')})"

            elif tool_name == "create_meeting_register":
                response = await client.post(
                    f"{NOTION_API_BASE}/api/meeting-register",
                    json=tool_input,
                    timeout=30.0
                )
                result = response.json()
                return f"Created meeting register entry '{tool_input.get('title')}' (ID: {result.get('id')})"

            elif tool_name == "create_eos_issue":
                response = await client.post(
                    f"{NOTION_API_BASE}/api/eos-issues",
                    json=tool_input,
                    timeout=30.0
                )
                result = response.json()
                return f"Created EOS issue '{tool_input.get('title')}' (ID: {result.get('id')})"

            elif tool_name == "create_speaker_alias":
                response = await client.post(
                    f"{NOTION_API_BASE}/api/speaker-aliases",
                    json=tool_input,
                    timeout=30.0
                )
                result = response.json()
                return f"Created speaker alias '{tool_input.get('alias')}' (ID: {result.get('id')})"

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
                        "project_id": tool_input.get("project_id"),
                        "organization_name": tool_input.get("organization_name")
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
    extraction_cost = 0.0
    extraction_usage = {"input_tokens": 0, "output_tokens": 0}

    if transcript_tokens > LONG_MEETING_THRESHOLD:
        # Two-pass processing: Haiku extracts, then Sonnet creates
        processing_method = "two_pass"
        logger.info(f"Long meeting detected: {transcript_tokens} tokens — using two-pass processing")

        # Build a brief context for Haiku so it preserves correct names
        # This runs BEFORE the full context load, so build it from raw context if available
        haiku_brief = ""
        try:
            import httpx as _hx
            _resp = _hx.get(f"{NOTION_API_BASE}/api/context", timeout=15.0)
            _ctx = _resp.json()
            _rock_titles = [r.get("title", "") for r in _ctx.get("rocks", [])]
            _people_names = [p.get("name", "") for p in _ctx.get("people", [])]
            _dept_names = [d.get("name", "") for d in _ctx.get("departments", [])]
            _custom = _ctx.get("agentConfig", {}).get("customInstructions", "")
            haiku_brief = (
                f"Known Rocks: {', '.join(_rock_titles[:10])}\n"
                f"Known People: {', '.join(_people_names)}\n"
                f"Known Departments: {', '.join(_dept_names)}\n"
            )
            if _custom:
                haiku_brief += f"\n{_custom}\n"
        except Exception as _e:
            logger.warning(f"Could not load context brief for Haiku: {_e}")

        long_result = process_long_meeting(client, sentences, context_brief=haiku_brief)
        extraction_cost = long_result["extraction_cost"]
        extraction_usage = long_result["extraction_usage"]

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

    # Duration — Fireflies sends minutes as a float (e.g., 49.58 for ~50 min)
    duration_raw = transcript_data.get('duration', 0) or 0
    duration_mins = round(duration_raw)
    duration_seconds = round(duration_raw * 60)

    # Model selection — always Sonnet
    complexity = detect_meeting_complexity(transcript_data)
    selected_model = SONNET_MODEL
    logger.info(f"Meeting complexity: {complexity} — using Sonnet ({SONNET_MODEL})")

    # Extract meeting format for in-person speaker inference
    meeting_format = transcript_data.get('meeting_format') or transcript_data.get('meetingFormat')
    if meeting_format:
        logger.info(f"Meeting format: {meeting_format}")

    # ── Load fresh Notion context ──
    logger.info("Loading fresh Notion context for prompt injection...")
    try:
        raw_context, context_section = await load_context_for_prompt(meeting_format=meeting_format)
        # Find default project ID from context
        projects_list = raw_context.get("projects", [])
        default_project_id = projects_list[0]["id"] if projects_list else None
        project_list_text = "\n".join(
            f"- {p['name']} (ID: {p['id']}, Status: {p.get('status', '?')})"
            for p in projects_list
        ) if projects_list else "No projects found."
        logger.info(f"Context loaded. {len(projects_list)} projects, default: {default_project_id}")
    except Exception as e:
        logger.warning(f"Failed to load Notion context: {e} — falling back to static prompt")
        context_section = ""
        default_project_id = None
        project_list_text = "Context unavailable — call get_projects() manually."

    # Build dynamic system prompt with injected context
    dynamic_system_prompt = build_system_prompt(context_section)
    CACHED_SYSTEM = [
        {
            "type": "text",
            "text": dynamic_system_prompt,
            "cache_control": {"type": "ephemeral"}
        }
    ]

    # Build user prompt
    project_instruction = ""
    if default_project_id:
        project_instruction = f"""
**AVAILABLE PROJECTS (from KNOWN DATA):**
{project_list_text}

Use project_id from the list above when creating notes and tasks. Default project: {default_project_id}
Do NOT call get_projects() — the project list is already provided above."""
    else:
        project_instruction = "First, call get_projects() to find existing projects to link to."

    prompt = f"""Process this meeting transcript and create DEEPLY DETAILED Notion entries.

## Meeting Information
- **Title**: {transcript_data.get('title', 'Untitled Meeting')}
- **Date**: {formatted_date}
- **Duration**: {duration_mins} minutes ({duration_seconds} seconds)
- **Meeting Format**: {meeting_format or 'Unknown (assume Virtual if Fireflies speaker labels are present)'}
- **Organizer**: {transcript_data.get('organizer_email', 'Unknown')}
- **Participants**: {', '.join(transcript_data.get('participants', []))}
- **Transcript URL**: {transcript_data.get('transcript_url', 'N/A')}

## Meeting Overview (from Fireflies)
{overview}

## Action Items (from Fireflies)
{action_items_text}

## Key Discussion Points (from Fireflies)
{key_points_text}

## Full Transcript
{transcript_text}

---

## INSTRUCTIONS — READ CAREFULLY

{project_instruction}

1. Create a DEEPLY DETAILED meeting note using the structured EOS fields. This is the most important step.
   You MUST populate ALL of these structured sections — do NOT skip any:
   
   - **meeting_info**: REQUIRED. Time, location, facilitator, scribe, attendees list with real names from KNOWN PEOPLE.
   - **segue**: REQUIRED. For EACH attendee, extract any good news or positive updates they shared.
   - **rock_review**: REQUIRED. Extract ALL strategic priorities. Reference KNOWN ROCKS by exact title when matching.
   - **scorecard**: REQUIRED if ANY numbers, metrics, targets, or KPIs are discussed.
   - **ids_issues**: CRITICAL — MOST IMPORTANT section. Extract EVERY distinct topic discussed 30+ seconds. Each needs: title, issue, root_cause, discussion_summary (3-5 sentences), solution (EOS language).
   - **conclude_todos**: REQUIRED. Extract EVERY action item. Each needs: action, owner (KNOWN PERSON name), due_date, department (KNOWN DEPARTMENT code).
   - **cascading_messages**: REQUIRED. What to communicate outside this meeting.
   - **next_meeting**: REQUIRED if follow-up mentioned.
   - **meeting_rating**: REQUIRED. List EACH attendee with rating or "To be submitted".

2. Extract ALL tasks — be aggressive. Link each to a project from KNOWN PROJECTS using project_id.

3. Group related tasks under parent tasks when 3+ relate to the same initiative.

4. Create a Meeting Register entry (create_meeting_register) with meeting metadata and link to the note.

5. For unresolved IDS issues, create EOS Issues (create_eos_issue) linked to the meeting note.

6. If new speaker-to-person mappings are discovered, create Speaker Aliases (create_speaker_alias).

7. If recurring meeting or unresolved issues, create a next meeting agenda.

8. Provide a summary of everything created.

**QUALITY CHECK:** IDS summaries 3-5 sentences? All to-dos specific with real names and dates? All projects from KNOWN PROJECTS?
"""

    results = {
        "meeting_id": transcript_data.get('id'),
        "title": transcript_data.get('title'),
        "messages": [],
        "success": False,
        "error": None,
        "summary": None,
        "created_note_id": None,
        "processing_method": processing_method,
        "model_used": selected_model,
        "complexity": complexity,
        "transcript_tokens": transcript_tokens,
        "token_usage": {
            "total_input": 0,
            "total_output": 0,
            "cache_creation": 0,
            "cache_read": 0,
            "extraction_input": extraction_usage["input_tokens"],
            "extraction_output": extraction_usage["output_tokens"],
        }
    }

    # Session-scoped cache for tool results
    projects_cache = {}

    # Initialize the output validator (Sonnet-powered cross-check layer)
    validator = OutputValidator()
    logger.info("Output validator initialized — all writes will be cross-checked against Notion data")

    try:
        messages = [{"role": "user", "content": prompt}]

        # Agentic loop - keep calling until no more tool use
        max_iterations = 30
        for iteration in range(max_iterations):
            logger.info(f"Claude iteration {iteration + 1} ({selected_model})...")

            response = client.messages.create(
                model=selected_model,
                max_tokens=8192,
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

            # Execute tools and add results (with validator cross-check)
            tool_results = []
            for tool_use in tool_uses:
                logger.info(f"Executing tool: {tool_use.name} with input: {tool_use.input}")
                result = await execute_tool(
                    tool_use.name, tool_use.input, projects_cache,
                    validator=validator, context_section=context_section
                )
                logger.info(f"Tool result: {result[:200]}...")
                # Capture the created meeting note ID for transcript attachment
                if tool_use.name == "create_meeting_note" and "with ID:" in result:
                    try:
                        results["created_note_id"] = result.split("with ID:")[-1].strip()
                    except Exception:
                        pass
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tool_use.id,
                    "content": result
                })

            messages.append({"role": "user", "content": tool_results})

        results["success"] = True

        # Calculate cost — Sonnet rates: $3/MTok input, $15/MTok output
        tu = results["token_usage"]
        input_rate, output_rate = 3.0, 15.0
        cache_write_rate = 3.75
        cache_read_rate = 0.3

        input_cost = tu["total_input"] * input_rate / 1_000_000
        output_cost = tu["total_output"] * output_rate / 1_000_000
        cache_write_cost = tu["cache_creation"] * cache_write_rate / 1_000_000
        cache_read_cost = tu["cache_read"] * cache_read_rate / 1_000_000
        # Extraction pass cost (already calculated, also Sonnet)
        total_cost = input_cost + output_cost + cache_write_cost + cache_read_cost + extraction_cost

        # Estimate what cache_read tokens would have cost without caching
        cache_savings = tu["cache_read"] * (input_rate - cache_read_rate) / 1_000_000

        results["cost_analysis"] = {
            "total_cost_usd": round(total_cost, 4),
            "agentic_loop_cost": round(input_cost + output_cost + cache_write_cost + cache_read_cost, 4),
            "extraction_cost": round(extraction_cost, 4),
            "cache_savings_usd": round(cache_savings, 4),
            "model_used": selected_model,
            "processing_method": processing_method,
        }

        # Add validator summary
        val_summary = validator.get_summary()
        results["validator"] = val_summary
        validator_cost = val_summary.get("validator_cost_usd", 0)
        total_cost += validator_cost

        results["cost_analysis"]["validator_cost"] = round(validator_cost, 4)
        results["cost_analysis"]["total_cost_usd"] = round(total_cost, 4)

        logger.info(f"Successfully processed meeting: {transcript_data.get('title')}")
        logger.info(f"  Cost: ${total_cost:.4f} (cache saved: ${cache_savings:.4f})")
        logger.info(f"  Validator: {val_summary['total_validations']} checks, {val_summary['total_corrections']} corrections, ${validator_cost:.4f}")
        logger.info(f"  Method: {processing_method} | Model: {selected_model} | Complexity: {complexity}")

    except Exception as e:
        results["error"] = str(e)
        logger.error(f"Error processing transcript: {e}")
        import traceback
        traceback.print_exc()

    return results
