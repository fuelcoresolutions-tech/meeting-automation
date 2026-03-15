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
        f"{len(ctx.get('projects', []))} projects "
        f"({sum(len(p.get('keywords', [])) for p in ctx.get('projects', []))} keywords), "
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


def format_context_for_prompt(ctx: dict, meeting_format: str = None) -> str:
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

    # ── In-Person meeting warning ──
    if meeting_format == "In-Person":
        lines.append("⚠️ **IN-PERSON MEETING DETECTED** — No automatic speaker labels exist in this transcript.")
        lines.append("Use the SPEAKER INFERENCE GUIDE below to identify speakers from content and role context.")
        lines.append("")

    # ── People ──
    lines.append("### KNOWN PEOPLE")
    lines.append("Match transcript speakers to these names. If someone is NOT here, add to new_people.")
    lines.append("| Name | ID | Role | Department | Job Description | Level |")
    lines.append("|------|-----|------|------------|-----------------|-------|")
    for p in people:
        dept_names = [_resolve_dept(did, departments) for did in p.get("departmentIds", [])]
        dept_str = ", ".join(dept_names) if dept_names else "—"
        role = p.get("role") or p.get("title") or "—"
        job_desc = p.get("jobDescription", "") or ""
        job_desc_short = (job_desc[:80] + "...") if len(job_desc) > 80 else job_desc or "—"
        level = p.get("positionLevel", "") or "—"
        lines.append(f"| {p['name']} | {p['id']} | {role} | {dept_str} | {job_desc_short} | {level} |")
    lines.append("")

    # ── Speaker Inference Guide ──
    people_with_jobs = [p for p in people if p.get("jobDescription")]
    if people_with_jobs:
        lines.append("### SPEAKER INFERENCE GUIDE (For In-Person / Unlabelled Meetings)")
        lines.append("Match speech content and topics to the job descriptions below to identify speakers.")
        lines.append("Use confidence scores: High (0.85+) = name mentioned + topic match; Medium (0.65–0.84) = topic match only; Low (<0.65) = use 'Unknown Speaker N'.")
        lines.append("")
        for p in people_with_jobs:
            role = p.get("role") or p.get("title") or "Unknown Role"
            level = p.get("positionLevel", "") or ""
            label = f"{role}, {level}" if level else role
            lines.append(f"**{p['name']}** ({label}):")
            lines.append(f"  {p['jobDescription']}")
            lines.append("")

    # ── Speaker Aliases ──
    lines.append("### KNOWN SPEAKER ALIASES")
    lines.append("| Alias | Person | Confidence | Notes |")
    lines.append("|-------|--------|------------|-------|")
    for a in aliases:
        person_names = [_resolve_name(pid, people) for pid in a.get("personIds", [])]
        person_str = ", ".join(person_names) if person_names else "Unknown"
        notes = a.get("notes", "") or "—"
        notes_short = (notes[:60] + "...") if len(notes) > 60 else notes
        lines.append(f"| {a['alias']} | {person_str} | {a.get('confidence', '?')} | {notes_short} |")
    lines.append("")

    # ── Projects ──
    lines.append("### KNOWN PROJECTS")
    lines.append("ALL tasks and notes MUST link to one of these projects by ID. NEVER invent project names.")
    lines.append("Use Keywords and Description to match transcript topics to the correct project(s).")
    lines.append("| Project Name | ID | Status | Client | Keywords | Description |")
    lines.append("|--------------|-----|--------|--------|----------|-------------|")
    for p in projects:
        keywords_str = ", ".join(p.get("keywords", [])) if p.get("keywords") else "—"
        client = p.get("client", "") or "—"
        description = p.get("description", "") or ""
        desc_short = (description[:100] + "...") if len(description) > 100 else description or "—"
        lines.append(f"| {p['name']} | {p['id']} | {p.get('status', '?')} | {client} | {keywords_str} | {desc_short} |")
    if not projects:
        lines.append("| (no projects found) | — | — | — | — | — |")
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

    # ── Database Schema Reference (valid values for all fields) ──
    lines.append("## ═══════ DATABASE FIELD REFERENCE ═══════")
    lines.append("Use ONLY these exact values when creating entries. Anything else will cause errors.")
    lines.append("")

    lines.append("### Tasks Database")
    lines.append("- **Status** (status): `To Do` | `Doing` | `Done` — NOT 'In Progress'")
    lines.append("- **Priority** (status): `Low` | `Medium` | `High`")
    lines.append("- **Project** (relation → Projects): Use project ID from KNOWN PROJECTS")
    lines.append("- **Department** (relation → Departments): Use department ID from KNOWN DEPARTMENTS")
    lines.append("- **People** (relation → People): Use person ID from KNOWN PEOPLE")
    lines.append("- **Parent Task** (relation → Tasks): Use task ID for subtasks")
    lines.append("- **Due** (date): YYYY-MM-DD format")
    lines.append("- **Description** (rich_text): Max 2000 chars")
    lines.append("")

    lines.append("### Notes Database")
    lines.append("- **Type** (select): `Journal` | `Meeting` | `Web Clip` | `Lecture` | `Reference` | `Book` | `Idea` | `Plan` | `Recipe` | `Voice Note` | `Daily` | `Agenda`")
    lines.append("- **Project** (relation → Projects): Use project ID")
    lines.append("- **People** (relation → People): Use person IDs")
    lines.append("- **Note Date** (date): YYYY-MM-DD")
    lines.append("- **Duration (Seconds)** (number): Integer seconds")
    lines.append("")

    lines.append("### Meeting Register Database")
    lines.append("- **Processing Status** (status): `Failed` | `Processing` | `Speaker Review` | `Not started` | `Pending` | `Completed`")
    lines.append("- **Meeting Format** (select): `Hybrid` | `Virtual` | `In-Person`")
    lines.append("- **Multi-select** (multi_select): `Same Page` | `Ad Hoc` | `State Of Company` | `Annual` | `Quartely` | `L10` — note: 'Quartely' not 'Quarterly'")
    lines.append("- **Facilitator** (relation → People): Use person ID")
    lines.append("- **Attendees** (relation → People): Use person IDs")
    lines.append("- **Department** (relation → Departments): Use department ID")
    lines.append("- **Planning Cycle** (relation → Planning Cycles): Use cycle ID")
    lines.append("- **Meeting Notes** (relation → Notes): Use the meeting note page ID after creating it")
    lines.append("")

    lines.append("### EOS Issues List Database")
    lines.append("- **Priority level** (select): `Low` | `Medium` | `High`")
    lines.append("- **Is Resolved** (checkbox): true/false")
    lines.append("- **Raised by** (relation → People): Use person ID")
    lines.append("- **Department** (relation → Departments): Use department ID")
    lines.append("- **Project** (relation → Projects): Use project ID")
    lines.append("- **Quarterly Rock** (relation → Quarterly Rocks): Use rock ID — LINK ISSUES TO RELEVANT ROCKS")
    lines.append("- **Source Meeting** (relation → Notes): Use the meeting note page ID — NOT Meeting Register ID")
    lines.append("- **Issue Description** (rich_text): Full description of the issue")
    lines.append("- **Resolution Notes** (rich_text): How it was resolved")
    lines.append("")

    lines.append("### Quarterly Rocks Database")
    lines.append("- **Status** (status): `Dropped` | `Off Track` | `Not started` | `On Track` | `Done`")
    lines.append("- **Owner** (relation → People): Use person ID")
    lines.append("- **Department** (relation → Departments): Use department ID")
    lines.append("- **Project** (relation → Projects): Use project ID")
    lines.append("- **Planning Cycle** (relation → Planning Cycles): Use cycle ID")
    lines.append("")

    lines.append("### Scorecard Metrics Database")
    lines.append("- **Frequency** (select): `Monthly` | `Weekly`")
    lines.append("- **Owner** (relation → People): Use person ID")
    lines.append("- **Department** (relation → Departments): Use department ID")
    lines.append("- **Target** (number): Numeric target value")
    lines.append("- **Current Value** (number): Latest actual value")
    lines.append("- **On track** (checkbox): true/false")
    lines.append("")

    lines.append("### Speaker Aliases Database")
    lines.append("- **Person** (relation → People): Use person ID")
    lines.append("- **Confidence** (number): 0.0 to 1.0")
    lines.append("- **Source** (rich_text): e.g. 'Fireflies'")
    lines.append("")

    lines.append("### Projects Database")
    lines.append("- **Status** (status): `Planned` | `On Hold` | `Doing` | `Ongoing` | `Done`")
    lines.append("- **Departments** (relation → Departments): Use department IDs")
    lines.append("- **People** (relation → People): Use person IDs")
    lines.append("")

    lines.append("### Planning Cycles Database")
    lines.append("- **Cycle Type** (select): `Annually` | `Quartely` — note: 'Quartely' not 'Quarterly'")
    lines.append("- **Is Current** (checkbox): Only one should be true per cycle type")
    lines.append("")

    return "\n".join(lines)


async def load_context_for_prompt(meeting_format: str = None) -> tuple[dict, str]:
    """Main entry point: fetch context and format for prompt injection.

    Args:
        meeting_format: Optional meeting format string (e.g. "In-Person", "Virtual", "Hybrid").
                        Triggers speaker inference warning when "In-Person".

    Returns:
        (raw_context_dict, formatted_prompt_section)
    """
    ctx = await fetch_notion_context()
    formatted = format_context_for_prompt(ctx, meeting_format=meeting_format)
    return ctx, formatted
