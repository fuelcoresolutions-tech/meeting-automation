"""
Context Loader — Fetches fresh Notion data and formats it as a
KNOWN DATA section for injection into the Claude system prompt.

Called before every transcript processing to ensure the agent
always sees the current state of all Notion databases.
"""

import os
import httpx
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

NOTION_API_BASE = os.getenv("NOTION_API_BASE", "http://127.0.0.1:3000")


async def fetch_notion_context() -> dict:
    """Fetch aggregated context from the Notion API bridge."""
    url = f"{NOTION_API_BASE}/api/context"
    logger.info(f"Fetching Notion context from {url}")
    async with httpx.AsyncClient() as client:
        response = await client.get(url, timeout=30.0)
        response.raise_for_status()
        ctx = response.json()
    logger.info(
        f"Context loaded: {len(ctx.get('people', []))} people, "
        f"{len(ctx.get('projects', []))} projects, "
        f"{len(ctx.get('departments', []))} departments, "
        f"{len(ctx.get('rocks', []))} rocks, "
        f"{len(ctx.get('speakerAliases', []))} aliases"
    )
    return ctx


def _resolve_name(person_id: str, people: list) -> str:
    """Resolve a person ID to a name."""
    for p in people:
        if p.get("id") == person_id:
            return p.get("name", "Unknown")
    return "Unknown"


def _resolve_dept(dept_id: str, departments: list) -> str:
    """Resolve a department ID to name (code)."""
    for d in departments:
        if d.get("id") == dept_id:
            code = d.get("code", "")
            name = d.get("name", "Unknown")
            return f"{name} ({code})" if code else name
    return "Unknown"


def format_context_for_prompt(ctx: dict) -> str:
    """Format Notion context as a KNOWN DATA section for the system prompt."""
    people = ctx.get("people", [])
    projects = ctx.get("projects", [])
    departments = ctx.get("departments", [])
    rocks = ctx.get("rocks", [])
    cycles = ctx.get("planningCycles", [])
    metrics = ctx.get("scorecardMetrics", [])
    issues = ctx.get("eosIssues", [])
    aliases = ctx.get("speakerAliases", [])
    config = ctx.get("agentConfig")

    lines = []
    lines.append("## ═══════ KNOWN NOTION DATA (GROUND TRUTH) ═══════")
    lines.append("")

    # ── Agent Config ──
    if config:
        lines.append("### AGENT CONFIG")
        lines.append(f"- Workspace: {config.get('workspaceName', 'Unknown')}")
        lines.append(f"- Default Todo Due Days: {config.get('defaultTodoDueDays', 7)}")
        lines.append(f"- Min Confidence Threshold: {config.get('minConfidenceThreshold', 0.6)}")
        lines.append(f"- Require Speaker Review (In Person): {config.get('requireSpeakerReview', True)}")
        custom = config.get("customInstructions", "")
        if custom:
            lines.append("")
            lines.append("### CUSTOM AGENT INSTRUCTIONS (FOLLOW THESE)")
            lines.append(custom)
        lines.append("")

    # ── People ──
    lines.append("### KNOWN PEOPLE")
    lines.append("Match transcript speakers to these names. If someone is NOT here, add to new_people.")
    lines.append("| Name | ID | Role | Department |")
    lines.append("|------|-----|------|------------|")
    for p in people:
        dept_names = [_resolve_dept(did, departments) for did in p.get("departmentIds", [])]
        dept_str = ", ".join(dept_names) if dept_names else "—"
        role = p.get("role") or p.get("title") or "—"
        lines.append(f"| {p['name']} | {p['id']} | {role} | {dept_str} |")
    lines.append("")

    # ── Speaker Aliases ──
    lines.append("### KNOWN SPEAKER ALIASES")
    lines.append("| Alias | Person | Confidence |")
    lines.append("|-------|--------|------------|")
    for a in aliases:
        person_names = [_resolve_name(pid, people) for pid in a.get("personIds", [])]
        person_str = ", ".join(person_names) if person_names else "Unknown"
        lines.append(f"| {a['alias']} | {person_str} | {a.get('confidence', '?')} |")
    lines.append("")

    # ── Projects ──
    lines.append("### KNOWN PROJECTS")
    lines.append("ALL tasks and notes MUST link to one of these projects by ID. NEVER invent project names.")
    lines.append("| Project Name | ID | Status |")
    lines.append("|--------------|-----|--------|")
    for p in projects:
        lines.append(f"| {p['name']} | {p['id']} | {p.get('status', '?')} |")
    if not projects:
        lines.append("| (no projects found) | — | — |")
    lines.append("")

    # ── Departments ──
    lines.append("### KNOWN DEPARTMENTS")
    lines.append("| Department | ID | Code | Level |")
    lines.append("|------------|-----|------|-------|")
    for d in departments:
        lines.append(f"| {d['name']} | {d['id']} | {d.get('code', '—')} | {d.get('level', '—')} |")
    lines.append("")

    # ── Planning Cycles ──
    current_cycle = None
    now = datetime.now().strftime("%Y-%m-%d")
    lines.append("### PLANNING CYCLES")
    lines.append("| Cycle | Type | Start | End | Current |")
    lines.append("|-------|------|-------|-----|---------|")
    for c in cycles:
        is_current = c.get("isCurrent", False)
        start = c.get("startDate", "")
        end = c.get("endDate", "")
        # Auto-detect current based on date if multiple are flagged
        if start and end and start <= now <= end:
            current_cycle = c
        lines.append(f"| {c['title']} | {c.get('cycleType', '?')} | {start} | {end} | {'✅' if is_current else ''} |")
    if current_cycle:
        lines.append(f"\n**Current Quarter:** {current_cycle['title']} (ends {current_cycle.get('endDate', '?')})")
    lines.append("")

    # ── Quarterly Rocks ──
    lines.append("### KNOWN QUARTERLY ROCKS")
    lines.append("When the transcript discusses a topic matching a rock, reference its exact title.")
    lines.append("| Rock Title | ID | Status | Owner | Department |")
    lines.append("|------------|-----|--------|-------|------------|")
    for r in rocks:
        owners = [_resolve_name(oid, people) for oid in r.get("ownerIds", [])]
        owner_str = ", ".join(owners) if owners else "—"
        depts = [_resolve_dept(did, departments) for did in r.get("departmentIds", [])]
        dept_str = ", ".join(depts) if depts else "—"
        lines.append(f"| {r['title']} | {r['id']} | {r.get('status', '?')} | {owner_str} | {dept_str} |")
    lines.append("")

    # ── Scorecard Metrics ──
    if metrics:
        lines.append("### KNOWN SCORECARD METRICS")
        lines.append("| Metric | Owner | Target | Current | On Track |")
        lines.append("|--------|-------|--------|---------|----------|")
        for m in metrics:
            owners = [_resolve_name(oid, people) for oid in m.get("ownerIds", [])]
            owner_str = ", ".join(owners) if owners else "—"
            lines.append(f"| {m['name']} | {owner_str} | {m.get('target', '—')} | {m.get('currentValue', '—')} | {'✅' if m.get('onTrack') else '❌'} |")
        lines.append("")

    # ── Unresolved EOS Issues ──
    unresolved = [i for i in issues if not i.get("isResolved")]
    if unresolved:
        lines.append("### OPEN EOS ISSUES (Unresolved)")
        lines.append("| Issue | Priority | Raised By | Department |")
        lines.append("|-------|----------|-----------|------------|")
        for i in unresolved:
            raised = [_resolve_name(rid, people) for rid in i.get("raisedByIds", [])]
            raised_str = ", ".join(raised) if raised else "—"
            depts = [_resolve_dept(did, departments) for did in i.get("departmentIds", [])]
            dept_str = ", ".join(depts) if depts else "—"
            lines.append(f"| {i['title']} | {i.get('priority', '—')} | {raised_str} | {dept_str} |")
        lines.append("")

    return "\n".join(lines)


async def load_context_for_prompt() -> tuple[dict, str]:
    """Main entry point: fetch context and format for prompt injection.
    
    Returns:
        (raw_context_dict, formatted_prompt_section)
    """
    ctx = await fetch_notion_context()
    formatted = format_context_for_prompt(ctx)
    return ctx, formatted
