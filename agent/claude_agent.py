import os
from datetime import datetime
from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient, create_sdk_mcp_server
from tools.notion_tools import (
    get_projects,
    create_meeting_note,
    create_task,
    create_subtask,
    create_project
)
from prompts.system_prompt import SYSTEM_PROMPT


def create_notion_mcp_server():
    """Create the MCP server with all Notion tools."""
    return create_sdk_mcp_server(
        name="notion-tools",
        version="1.0.0",
        tools=[
            get_projects,
            create_meeting_note,
            create_task,
            create_subtask,
            create_project
        ]
    )


async def process_meeting_transcript(transcript_data: dict) -> dict:
    """
    Process a meeting transcript using Claude Agent.

    Args:
        transcript_data: Dictionary containing:
            - id: Meeting ID
            - title: Meeting title
            - date: Meeting date (ISO timestamp)
            - duration: Duration in seconds
            - summary: {overview, action_items, shorthand_bullet, keywords}
            - sentences: [{speaker_name, text}, ...]

    Returns:
        Dictionary with processing results
    """
    # Create the MCP server
    notion_server = create_notion_mcp_server()

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

    # Format action items
    action_items_text = '\n'.join(f"- {item}" for item in action_items) if action_items else 'No action items identified'

    # Format key points
    key_points_text = '\n'.join(f"- {point}" for point in key_points) if key_points else 'No key points available'

    # Format transcript (limit to first 100 sentences to avoid token limits)
    transcript_lines = []
    for s in sentences[:100]:
        speaker = s.get('speaker_name', 'Unknown')
        text = s.get('text', '')
        transcript_lines.append(f"**{speaker}**: {text}")
    transcript_text = '\n'.join(transcript_lines) if transcript_lines else 'No transcript available'
    if len(sentences) > 100:
        transcript_text += '\n... (transcript truncated for processing)'

    # Build the prompt
    duration_mins = (transcript_data.get('duration', 0) or 0) // 60

    prompt = f"""Process the following meeting transcript and create appropriate Notion entries:

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
3. Analyze the action items AND the transcript to extract all tasks
4. Group related tasks under parent tasks where appropriate
5. Set priorities and deadlines based on the discussion context
6. Provide a summary of what was created
"""

    # Configure the agent
    options = ClaudeAgentOptions(
        model=os.getenv("CLAUDE_MODEL", "claude-sonnet-4-20250514"),
        mcp_servers={"notion": notion_server},
        allowed_tools=[
            "mcp__notion__get_projects",
            "mcp__notion__create_meeting_note",
            "mcp__notion__create_task",
            "mcp__notion__create_subtask",
            "mcp__notion__create_project"
        ],
        system_prompt=SYSTEM_PROMPT,
        max_turns=15,
        permission_mode="acceptEdits"
    )

    results = {
        "meeting_id": transcript_data.get('id'),
        "title": transcript_data.get('title'),
        "messages": [],
        "success": False,
        "error": None,
        "summary": None
    }

    try:
        async with ClaudeSDKClient(options=options) as client:
            await client.query(prompt)

            async for msg in client.receive_response():
                results["messages"].append(str(msg))

                # Extract text content for summary
                if hasattr(msg, 'content'):
                    for block in msg.content:
                        if hasattr(block, 'text'):
                            results["summary"] = block.text

        results["success"] = True
        print(f"Successfully processed meeting: {transcript_data.get('title')}")

    except Exception as e:
        results["error"] = str(e)
        print(f"Error processing transcript: {e}")

    return results
