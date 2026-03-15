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
    n_people = len(ctx.get('people', []))
    n_projects = len(ctx.get('projects', []))
    total_kw = sum(len(p.get('keywords', [])) for p in ctx.get('projects', []))
    n_depts = len(ctx.get('departments', []))
    n_rocks = len(ctx.get('rocks', []))
    n_aliases = len(ctx.get('speakerAliases', []))
    n_metrics = len(ctx.get('scorecardMetrics', []))
    n_issues = len([i for i in ctx.get('eosIssues', []) if not i.get('isResolved')])
    logger.info(
        f"Context loaded: {n_people} people, {n_projects} projects ({total_kw} keywords), "
        f"{n_depts} depts, {n_rocks} rocks, {n_aliases} aliases, "
        f"{n_metrics} metrics, {n_issues} open issues"
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


def _resolve_person_project(person: dict, departments: list) -> str:
    """Derive a person's project/org from their department's Project field."""
    for did in person.get("departmentIds", []):
        dept = next((d for d in departments if d.get("id") == did), None)
        if dept and dept.get("project"):
            return dept["project"]
    return "—"


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
    lines.append("| Name | ID | Role | Department | Relationship | Project |")
    lines.append("|------|-----|------|------------|--------------|---------|")
    for p in people:
        name = p['name'].strip()  # normalize trailing spaces
        dept_names = [_resolve_dept(did, departments) for did in p.get("departmentIds", [])]
        dept_str = ", ".join(dept_names) if dept_names else "—"
        role = p.get("role") or p.get("title") or "—"
        rel = ", ".join(p.get("relationship", [])) or "External"
        proj = _resolve_person_project(p, departments)
        lines.append(f"| {name} | {p['id']} | {role} | {dept_str} | {rel} | {proj} |")
    lines.append("")

    # ── Speaker Inference Guide ──
    people_with_jobs = [p for p in people if p.get("jobDescription")]
    if people_with_jobs:
        lines.append("### SPEAKER INFERENCE GUIDE (For In-Person / Unlabelled Meetings)")
        lines.append("Match speech content and topics to the job descriptions below to identify speakers.")
        lines.append("Use confidence: High (0.85+) = name mentioned + topic match; Medium (0.65–0.84) = topic match only; Low (<0.65) = 'Unknown Speaker N'.")
        lines.append("")
        for p in people_with_jobs:
            name = p['name'].strip()
            role = p.get("role") or p.get("title") or "Unknown Role"
            lines.append(f"**{name}** — {role} (ID: {p['id']}):")
            lines.append(f"  {p['jobDescription']}")
            lines.append("")

    # ── Speaker Aliases ──
    lines.append("### KNOWN SPEAKER ALIASES")
    lines.append("When Fireflies labels a speaker with one of these aliases, resolve to the person ID shown.")
    lines.append("| Alias | Resolved Person | Person ID | Confidence |")
    lines.append("|-------|----------------|-----------|------------|")
    for a in aliases:
        person_names = [_resolve_name(pid, people).strip() for pid in a.get("personIds", [])]
        person_ids = a.get("personIds", [])
        person_str = ", ".join(person_names) if person_names else "⚠️ UNRESOLVED — add to new_people"
        id_str = ", ".join(person_ids) if person_ids else "—"
        conf = a.get("confidence", "?")
        lines.append(f"| {a['alias']} | {person_str} | {id_str} | {conf} |")
    lines.append("")

    # ── Projects ──
    lines.append("### KNOWN PROJECTS")
    lines.append("ALL tasks and notes MUST link to one of these projects by ID. NEVER invent project names.")
    lines.append("Use Keywords and Description to match transcript topics to the correct project(s).")
    lines.append("| Project Name | ID | Status | Client | Keywords |")
    lines.append("|--------------|-----|--------|--------|----------|")
    for p in projects:
        keywords_str = ", ".join(p.get("keywords", [])) if p.get("keywords") else "—"
        client = p.get("client", "") or "—"
        lines.append(f"| {p['name']} | {p['id']} | {p.get('status', '?')} | {client} | {keywords_str} |")
    if not projects:
        lines.append("| (no projects found) | — | — | — | — |")
    lines.append("")

    # ── Full Project Descriptions (for cross-project topic matching) ──
    lines.append("### PROJECT DESCRIPTIONS (Read carefully for cross-project detection)")
    lines.append("When a transcript covers topics from multiple projects, link the meeting note to ALL relevant project IDs using project_ids array. Route each task to the most specific matching project.")
    lines.append("")
    for p in projects:
        description = p.get("description", "") or ""
        keywords = p.get("keywords", [])
        lines.append(f"**{p['name']}** (ID: `{p['id']}`)")
        if keywords:
            lines.append(f"  Keywords: {', '.join(keywords)}")
        if description:
            lines.append(f"  {description}")
        else:
            lines.append("  _(No description yet — match by project name and keywords only)_")
        lines.append("")

    # ── Departments ──
    lines.append("### KNOWN DEPARTMENTS")
    lines.append("The 'Project' column shows which organization/project owns this department. Use it to match task/issue department_ids to the correct project.")
    lines.append("| Department | ID | Code | Level | Project |")
    lines.append("|------------|-----|------|-------|---------|")
    for d in departments:
        proj = d.get('project') or '—'
        lines.append(f"| {d['name']} | {d['id']} | {d.get('code', '—')} | {d.get('level', '—')} | {proj} |")
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
    lines.append("| Rock Title | ID | Status | Owner | Due | Department |")
    lines.append("|------------|-----|--------|-------|-----|------------|")
    for r in rocks:
        owners = [_resolve_name(oid, people).strip() for oid in r.get("ownerIds", [])]
        owner_str = ", ".join(owners) if owners else "—"
        depts = [_resolve_dept(did, departments) for did in r.get("departmentIds", [])]
        dept_str = ", ".join(depts) if depts else "—"
        due = r.get("dueDate", "") or "—"
        status = r.get("status", "?")
        # Flag overdue rocks
        overdue_flag = ""
        if due and due != "—" and status not in ("Done",):
            if due < now:
                overdue_flag = " ⚠️OVERDUE"
        lines.append(f"| {r['title']} | {r['id']} | {status}{overdue_flag} | {owner_str} | {due} | {dept_str} |")
    lines.append("")

    # ── Scorecard Metrics ──
    if metrics:
        lines.append("### KNOWN SCORECARD METRICS")
        lines.append("When the transcript mentions actual figures for these metrics, note them. If a metric value is mentioned, update it.")
        lines.append("| Metric | Owner | Target | Current | On Track | Frequency |")
        lines.append("|--------|-------|--------|---------|----------|-----------|")
        for m in metrics:
            owners = [_resolve_name(oid, people).strip() for oid in m.get("ownerIds", [])]
            owner_str = ", ".join(owners) if owners else "—"
            current = m.get("currentValue")
            current_str = str(current) if current is not None else "NOT TRACKED"
            target = m.get("target")
            target_str = str(target) if target is not None else "NOT SET"
            on_track = "✅" if m.get("onTrack") else "❌"
            freq = m.get("frequency", "—")
            lines.append(f"| {m['name']} | {owner_str} | {target_str} | {current_str} | {on_track} | {freq} |")
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
