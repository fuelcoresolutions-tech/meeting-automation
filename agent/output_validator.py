"""
Output Validator — Two-phase validation layer that cross-checks every
agent output against LIVE Notion data before writing.

Phase 1 (Deterministic): Fetches fresh data from /api/context, builds
  ID lookup maps, validates every ID exists, checks status/select values,
  fixes date formats. Zero LLM cost — pure programmatic checks.

Phase 2 (Claude Sonnet): For payloads that pass Phase 1, runs a semantic
  check for name accuracy, factual errors, and business context issues
  (e.g. Starbucks→Stabex). Only called when Phase 1 passes.

Architecture:
  Agent → Validator Phase 1 (deterministic) → Validator Phase 2 (Sonnet) → Notion API
"""

import os
import re
import json
import httpx
import logging
from anthropic import Anthropic
from typing import Optional

logger = logging.getLogger(__name__)

SONNET_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-20250514")
NOTION_API_BASE = os.getenv("NOTION_API_BASE", "http://127.0.0.1:3000")

# ─── Valid values for each status/select field (from deep schema audit) ────
VALID_VALUES = {
    "task_status": {"To Do", "Doing", "Done"},
    "task_priority": {"Low", "Medium", "High"},
    "project_status": {"Planned", "On Hold", "Doing", "Ongoing", "Done"},
    "rock_status": {"Dropped", "Off Track", "Not started", "On Track", "Done"},
    "meeting_processing_status": {"Failed", "Processing", "Speaker Review", "Not started", "Pending", "Completed"},
    "meeting_format": {"Hybrid", "Virtual", "In-Person"},
    "meeting_types": {"Same Page", "Ad Hoc", "State Of Company", "Annual", "Quartely", "L10"},
    "issue_priority": {"Low", "Medium", "High"},
    "scorecard_frequency": {"Monthly", "Weekly"},
    "note_type": {"Journal", "Meeting", "Web Clip", "Lecture", "Reference", "Book", "Idea", "Plan", "Recipe", "Voice Note", "Daily", "Agenda"},
}

# Known hallucination patterns
NAME_CORRECTIONS = {
    "starbucks": "Stabex",
    "star bucks": "Stabex",
}

STATUS_CORRECTIONS = {
    "In Progress": "Doing",
    "in progress": "Doing",
    "Not Started": "Not started",
    "Quarterly": "Quartely",
}


class OutputValidator:
    """Two-phase output validation: deterministic checks + Sonnet semantic review."""

    def __init__(self):
        self.client = Anthropic()
        self.total_tokens = {"input": 0, "output": 0}
        self.total_corrections = 0
        self.total_phase1_corrections = 0
        self.total_phase2_corrections = 0
        self.validation_log = []
        self._context_cache = None
        self._context_ids = None

    async def _load_live_context(self):
        """Fetch fresh context from Notion API and build ID lookup sets."""
        if self._context_cache is not None:
            return

        logger.info("  Validator: Fetching live Notion data...")
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{NOTION_API_BASE}/api/context", timeout=30.0)
            resp.raise_for_status()
            self._context_cache = resp.json()

        ctx = self._context_cache
        self._context_ids = {
            "people_ids": {p["id"] for p in ctx.get("people", [])},
            "people_names": {p["name"].lower().strip(): p["id"] for p in ctx.get("people", [])},
            "project_ids": {p["id"] for p in ctx.get("projects", [])},
            "project_names": {p["name"].lower().strip(): p["id"] for p in ctx.get("projects", [])},
            "dept_ids": {d["id"] for d in ctx.get("departments", [])},
            "dept_codes": {d.get("code", "").lower(): d["id"] for d in ctx.get("departments", []) if d.get("code")},
            "rock_ids": {r["id"] for r in ctx.get("rocks", [])},
            "cycle_ids": {c["id"] for c in ctx.get("planningCycles", [])},
        }

        ppl = len(self._context_ids["people_ids"])
        proj = len(self._context_ids["project_ids"])
        dept = len(self._context_ids["dept_ids"])
        logger.info(f"  Validator: Live context loaded — {ppl} people, {proj} projects, {dept} depts")

    def _check_id_list(self, id_list, id_set, label):
        """Check a list of IDs against the lookup set. Returns corrections."""
        if not id_list:
            return []
        corrections = []
        for i, id_val in enumerate(id_list):
            if id_val not in id_set:
                corrections.append({
                    "field": f"{label}[{i}]",
                    "original": id_val,
                    "corrected": "removed",
                    "reason": f"ID not found in {label} database — removed"
                })
        return corrections

    def _fix_text(self, text):
        """Apply known name corrections. Returns (fixed_text, corrections)."""
        if not text:
            return text, []
        corrections = []
        fixed = text
        for wrong, right in NAME_CORRECTIONS.items():
            if wrong in fixed.lower():
                pattern = re.compile(re.escape(wrong), re.IGNORECASE)
                fixed = pattern.sub(right, fixed)
                corrections.append({
                    "field": "text", "original": wrong,
                    "corrected": right, "reason": f"Known name correction"
                })
        return fixed, corrections

    def _fix_status(self, value, valid_set, field_name):
        """Fix status/select values. Returns (fixed_value, correction_or_None)."""
        if not value:
            return value, None
        if value in valid_set:
            return value, None
        if value in STATUS_CORRECTIONS:
            corrected = STATUS_CORRECTIONS[value]
            if corrected in valid_set:
                return corrected, {"field": field_name, "original": value, "corrected": corrected, "reason": "Auto-corrected status value"}
        for valid in valid_set:
            if value.lower() == valid.lower():
                return valid, {"field": field_name, "original": value, "corrected": valid, "reason": "Case mismatch corrected"}
        return value, {"field": field_name, "original": value, "corrected": "INVALID", "reason": f"Not in valid set: {valid_set}"}

    async def _phase1_deterministic(self, tool_name, payload):
        """Phase 1: Deterministic validation against live Notion IDs and valid values."""
        await self._load_live_context()
        ids = self._context_ids
        corrections = []
        p = dict(payload)

        # ── ID Validations ──
        if "project_id" in p and p["project_id"]:
            if p["project_id"] not in ids["project_ids"]:
                name_lower = p["project_id"].lower().strip()
                if name_lower in ids["project_names"]:
                    old = p["project_id"]
                    p["project_id"] = ids["project_names"][name_lower]
                    corrections.append({"field": "project_id", "original": old, "corrected": p["project_id"], "reason": "Resolved project name to ID"})
                elif ids["project_ids"]:
                    old = p["project_id"]
                    p["project_id"] = list(ids["project_ids"])[0]
                    corrections.append({"field": "project_id", "original": old, "corrected": p["project_id"], "reason": "Invalid project ID → using default"})

        # Check relation ID arrays — skip sourceMeetingIds/meetingNoteIds (newly created pages)
        skip_fields = {"sourceMeetingIds", "meetingNoteIds"}
        id_checks = [
            ("department_ids", ids["dept_ids"]), ("departmentIds", ids["dept_ids"]),
            ("people_ids", ids["people_ids"]), ("peopleIds", ids["people_ids"]),
            ("raisedByIds", ids["people_ids"]), ("facilitatorIds", ids["people_ids"]),
            ("attendeeIds", ids["people_ids"]), ("ownerIds", ids["people_ids"]),
            ("rockIds", ids["rock_ids"]), ("projectIds", ids["project_ids"]),
            ("planningCycleIds", ids["cycle_ids"]),
        ]
        for field, id_set in id_checks:
            if field in p and isinstance(p[field], list) and field not in skip_fields:
                bad = self._check_id_list(p[field], id_set, field)
                if bad:
                    p[field] = [v for v in p[field] if v in id_set]
                    corrections.extend(bad)

        # ── Auto-inject people when missing on tasks/notes ──
        if tool_name in ("create_task", "create_subtask") and (not p.get("people_ids") or len(p.get("people_ids", [])) == 0):
            # Fallback: assign to first known person (facilitator/default)
            if ids["people_ids"]:
                fallback_id = list(ids["people_ids"])[0]
                p["people_ids"] = [fallback_id]
                corrections.append({
                    "field": "people_ids", "original": "[]",
                    "corrected": f"[{fallback_id}]",
                    "reason": "No people assigned — auto-assigned to default person"
                })

        if tool_name == "create_meeting_note" and (not p.get("people_ids") or len(p.get("people_ids", [])) == 0):
            # Assign all known people as attendees if none specified
            if ids["people_ids"]:
                all_ids = list(ids["people_ids"])
                p["people_ids"] = all_ids
                corrections.append({
                    "field": "people_ids", "original": "[]",
                    "corrected": f"[{len(all_ids)} people]",
                    "reason": "No attendees assigned to meeting note — auto-assigned all known people"
                })

        # ── Status/Select Validations ──
        status_checks = [
            ("status", VALID_VALUES["task_status"]),
            ("priority", VALID_VALUES["task_priority"]),
            ("processingStatus", VALID_VALUES["meeting_processing_status"]),
            ("meetingFormat", VALID_VALUES["meeting_format"]),
        ]
        for field, valid_set in status_checks:
            if field in p and p[field]:
                fixed, c = self._fix_status(p[field], valid_set, field)
                p[field] = fixed
                if c:
                    corrections.append(c)

        if "meetingTypes" in p and isinstance(p["meetingTypes"], list):
            fixed_types = []
            for mt in p["meetingTypes"]:
                fixed, c = self._fix_status(mt, VALID_VALUES["meeting_types"], "meetingTypes")
                fixed_types.append(fixed)
                if c:
                    corrections.append(c)
            p["meetingTypes"] = fixed_types

        # ── Text Corrections (known hallucinations) ──
        text_fields = ["title", "name", "description", "issueDescription",
                       "resolutionNotes", "confidenceNotes", "alias"]
        for field in text_fields:
            if field in p and isinstance(p[field], str):
                fixed, text_corrs = self._fix_text(p[field])
                if text_corrs:
                    for tc in text_corrs:
                        tc["field"] = field
                    corrections.extend(text_corrs)
                    p[field] = fixed

        # Fix nested objects (meeting_info, segue, ids_issues, etc.)
        nested_keys = ["meeting_info", "segue", "scorecard", "rock_review", "todo_review",
                       "headlines", "ids_issues", "conclude_todos", "cascading_messages",
                       "next_meeting", "meeting_rating"]
        for key in nested_keys:
            if key in p and p[key]:
                raw = json.dumps(p[key])
                fixed, nested_corrs = self._fix_text(raw)
                if nested_corrs:
                    for nc in nested_corrs:
                        nc["field"] = f"{key}.{nc['field']}"
                    corrections.extend(nested_corrs)
                    p[key] = json.loads(fixed)

        # ── Date Format ──
        for field in ["date", "due_date", "dueDate", "meetingDate", "meeting_date"]:
            if field in p and p[field] and isinstance(p[field], str):
                if not re.match(r"^\d{4}-\d{2}-\d{2}", p[field]):
                    corrections.append({"field": field, "original": p[field], "corrected": p[field], "reason": "Date format should be YYYY-MM-DD"})

        # ── Rich Text Truncation ──
        for field in ["description", "issueDescription", "resolutionNotes"]:
            if field in p and isinstance(p[field], str) and len(p[field]) > 2000:
                p[field] = p[field][:1997] + "..."
                corrections.append({"field": field, "original": f"({len(payload.get(field, ''))} chars)", "corrected": "truncated to 2000", "reason": "Notion rich_text max"})

        self.total_phase1_corrections += len(corrections)
        passed = not any(c.get("corrected") in ("INVALID", "INVALID_ID") for c in corrections)
        return p, corrections, passed

    async def _phase2_semantic(self, tool_name, payload, context_section):
        """Phase 2: Sonnet semantic check for factual accuracy."""
        user_prompt = f"""Cross-check this payload for factual accuracy.

TOOL: {tool_name}

PAYLOAD:
```json
{json.dumps(payload, indent=2, default=str)}
```

BUSINESS CONTEXT:
{context_section}

Check for:
1. Incorrect company/client names (e.g. "Starbucks" should be "Stabex")
2. Incorrect people names or roles
3. Rock titles that don't match KNOWN ROCKS
4. Any factual inconsistencies

Return ONLY valid JSON:
{{
  "validated_payload": {{ ... }},
  "corrections": [ {{ "field": "...", "original": "...", "corrected": "...", "reason": "..." }} ],
  "confidence": 0.95
}}
If no corrections needed, return original payload with empty corrections array."""

        try:
            response = self.client.messages.create(
                model=SONNET_MODEL,
                max_tokens=4096,
                system="You are a data quality checker for Fuel Core Solutions. Fix factual errors. Return ONLY JSON.",
                messages=[{"role": "user", "content": user_prompt}]
            )

            usage = response.usage
            self.total_tokens["input"] += usage.input_tokens
            self.total_tokens["output"] += usage.output_tokens

            text = response.content[0].text.strip()
            if text.startswith("```json"):
                text = text[7:]
            if text.startswith("```"):
                text = text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

            result = json.loads(text)
            corrections = result.get("corrections", [])
            validated = result.get("validated_payload", payload)
            self.total_phase2_corrections += len(corrections)

            for c in corrections:
                logger.warning(
                    f"  VALIDATOR P2 [{tool_name}]: {c.get('field', '?')} — "
                    f"'{c.get('original', '?')}' → '{c.get('corrected', '?')}' "
                    f"({c.get('reason', '')})"
                )

            return validated, corrections

        except Exception as e:
            logger.error(f"  Validator Phase 2 error: {e} — skipping semantic check")
            return payload, []

    async def validate(self, tool_name, tool_input, context_section):
        """Full two-phase validation.

        Args:
            tool_name: The tool being called
            tool_input: The payload to validate
            context_section: Formatted Notion context for Phase 2

        Returns: dict with payload, corrections, confidence, passed
        """
        if tool_name in ("get_projects", "get_context"):
            return {"payload": tool_input, "corrections": [], "confidence": 1.0, "passed": True}

        all_corrections = []

        # ── Phase 1: Deterministic (free — no LLM) ──
        p1_payload, p1_corrections, p1_passed = await self._phase1_deterministic(tool_name, tool_input)
        all_corrections.extend(p1_corrections)

        if p1_corrections:
            logger.info(f"  Validator P1: {len(p1_corrections)} deterministic corrections")

        if not p1_passed:
            logger.warning(f"  Validator P1 FAILED for {tool_name}")
            self.validation_log.append({"tool": tool_name, "phase": "P1_FAIL", "corrections": len(p1_corrections), "passed": False})
            return {"payload": p1_payload, "corrections": all_corrections, "confidence": 0.3, "passed": False}

        # ── Phase 2: Semantic (Sonnet call) ──
        p2_payload, p2_corrections = await self._phase2_semantic(tool_name, p1_payload, context_section)
        all_corrections.extend(p2_corrections)

        self.total_corrections += len(all_corrections)
        confidence = 0.98 if not all_corrections else 0.90

        self.validation_log.append({
            "tool": tool_name,
            "p1_corrections": len(p1_corrections),
            "p2_corrections": len(p2_corrections),
            "total_corrections": len(all_corrections),
            "confidence": confidence,
            "passed": True,
        })

        logger.info(
            f"  Validator: {tool_name} — PASS "
            f"(P1: {len(p1_corrections)} fixes, P2: {len(p2_corrections)} fixes, conf: {confidence})"
        )

        return {
            "payload": p2_payload,
            "corrections": all_corrections,
            "confidence": confidence,
            "passed": True,
        }

    def get_summary(self):
        """Return a summary of all validations performed."""
        return {
            "total_validations": len(self.validation_log),
            "total_corrections": self.total_corrections,
            "phase1_corrections": self.total_phase1_corrections,
            "phase2_corrections": self.total_phase2_corrections,
            "total_tokens": self.total_tokens,
            "validator_cost_usd": round(
                (self.total_tokens["input"] * 3.0 + self.total_tokens["output"] * 15.0) / 1_000_000, 4
            ),
            "validations": self.validation_log,
        }
