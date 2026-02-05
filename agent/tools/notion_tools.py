from claude_agent_sdk import tool
from typing import Any
import httpx
import os

NOTION_API_BASE = os.getenv("NOTION_API_BASE", "http://localhost:3000")


@tool(
    name="get_projects",
    description="Retrieve all existing projects from Notion. Use this first to find relevant projects for linking tasks and notes.",
    input_schema={}
)
async def get_projects(args: dict[str, Any]) -> dict[str, Any]:
    """Fetch all projects from Notion database."""
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{NOTION_API_BASE}/api/projects", timeout=30.0)
        projects = response.json()

    if not projects:
        return {
            "content": [{
                "type": "text",
                "text": "No projects found in the database."
            }]
        }

    return {
        "content": [{
            "type": "text",
            "text": f"Found {len(projects)} projects:\n" + "\n".join(
                f"- {p['name']} (ID: {p['id']}, Status: {p.get('status', 'Unknown')})"
                for p in projects
            )
        }]
    }


@tool(
    name="create_meeting_note",
    description="Create a meeting note in the Notion Notes database with overview, action items, and key points.",
    input_schema={
        "title": str,
        "date": str,
        "duration_seconds": int,
        "overview": str,
        "action_items": list,
        "key_points": list,
        "project_id": str
    }
)
async def create_meeting_note(args: dict[str, Any]) -> dict[str, Any]:
    """Create a meeting note in Notion."""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{NOTION_API_BASE}/api/notes",
            json={
                "title": args.get("title"),
                "date": args.get("date"),
                "duration_seconds": args.get("duration_seconds"),
                "overview": args.get("overview"),
                "action_items": args.get("action_items", []),
                "key_points": args.get("key_points", []),
                "project_id": args.get("project_id")
            },
            timeout=30.0
        )
        result = response.json()

    return {
        "content": [{
            "type": "text",
            "text": f"Created meeting note '{args.get('title')}' with ID: {result.get('id')}"
        }]
    }


@tool(
    name="create_task",
    description="Create a task in the Notion Tasks database. Can optionally link to a project.",
    input_schema={
        "name": str,
        "description": str,
        "priority": str,
        "due_date": str,
        "status": str,
        "project_id": str
    }
)
async def create_task(args: dict[str, Any]) -> dict[str, Any]:
    """Create a task in Notion."""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{NOTION_API_BASE}/api/tasks",
            json={
                "name": args.get("name"),
                "description": args.get("description"),
                "priority": args.get("priority", "Medium"),
                "dueDate": args.get("due_date"),
                "status": args.get("status", "To Do"),
                "projectId": args.get("project_id")
            },
            timeout=30.0
        )
        result = response.json()

    return {
        "content": [{
            "type": "text",
            "text": f"Created task '{args.get('name')}' (ID: {result.get('id')}, Priority: {args.get('priority', 'Medium')}, Due: {args.get('due_date', 'Not set')})"
        }]
    }


@tool(
    name="create_subtask",
    description="Create a subtask linked to a parent task. Use this to break down larger tasks into actionable steps.",
    input_schema={
        "name": str,
        "description": str,
        "priority": str,
        "due_date": str,
        "parent_task_id": str,
        "project_id": str
    }
)
async def create_subtask(args: dict[str, Any]) -> dict[str, Any]:
    """Create a subtask linked to a parent task."""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{NOTION_API_BASE}/api/tasks",
            json={
                "name": args.get("name"),
                "description": args.get("description"),
                "priority": args.get("priority", "Medium"),
                "dueDate": args.get("due_date"),
                "status": "To Do",
                "parentTaskId": args.get("parent_task_id"),
                "projectId": args.get("project_id")
            },
            timeout=30.0
        )
        result = response.json()

    return {
        "content": [{
            "type": "text",
            "text": f"Created subtask '{args.get('name')}' under parent task (ID: {result.get('id')})"
        }]
    }


@tool(
    name="create_project",
    description="Create a new project in Notion. Only use when multiple related tasks (3+) don't fit any existing project.",
    input_schema={
        "name": str,
        "description": str,
        "status": str
    }
)
async def create_project(args: dict[str, Any]) -> dict[str, Any]:
    """Create a new project in Notion."""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{NOTION_API_BASE}/api/projects",
            json={
                "name": args.get("name"),
                "description": args.get("description"),
                "status": args.get("status", "Planned")
            },
            timeout=30.0
        )
        result = response.json()

    return {
        "content": [{
            "type": "text",
            "text": f"Created project '{args.get('name')}' with ID: {result.get('id')}"
        }]
    }
