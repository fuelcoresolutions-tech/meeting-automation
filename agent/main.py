from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator
from typing import Optional, List, Dict, Any, Union
from datetime import datetime
import asyncio
import logging
import os
import re
import traceback
import httpx
from datetime import timezone, timedelta
from email.utils import parsedate_to_datetime
from dotenv import load_dotenv

# Load environment variables from parent directory
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

from claude_agent import process_meeting_transcript

# Enhanced logging for Railway visibility
log_level = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, log_level),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('/tmp/agent.log', encoding='utf-8')
    ]
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Claude Meeting Agent",
    description="Intelligent meeting processing agent using Claude Agent SDK",
    version="1.0.0"
)

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.error(f"Validation error: {exc.errors()}")
    logger.error(f"Request body: {await request.body()}")
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors(), "body": exc.body}
    )


class TranscriptSummary(BaseModel):
    overview: Optional[str] = None
    action_items: Optional[Union[List[str], str]] = None  # Fireflies returns string, not list
    shorthand_bullet: Optional[Union[List[str], str]] = None  # Fireflies returns string, not list
    keywords: Optional[Union[List[str], str]] = None  # Can be list or string


class Sentence(BaseModel):
    speaker_name: Optional[str] = None
    text: str


class TranscriptData(BaseModel):
    id: str
    title: str
    date: Optional[Union[str, int, float]] = None
    duration: Optional[float] = 0  # Fireflies returns duration as float (e.g., 0.5)
    summary: Optional[TranscriptSummary] = None
    sentences: Optional[List[Sentence]] = []
    transcript_url: Optional[str] = None
    organizer_email: Optional[str] = None
    participants: Optional[List[str]] = []

    @field_validator('date', mode='before')
    @classmethod
    def convert_timestamp_to_string(cls, v):
        """Convert numeric timestamp to ISO date string."""
        if v is None:
            return None
        if isinstance(v, (int, float)):
            # Assume milliseconds timestamp from Fireflies
            return datetime.fromtimestamp(v / 1000).isoformat()
        return str(v)


class ProcessingResult(BaseModel):
    meeting_id: str
    title: str
    success: bool
    error: Optional[str] = None
    summary: Optional[str] = None


# In-memory processing status (use Redis/DB in production)
processing_status: Dict[str, Any] = {}

# Queue of meetings waiting to be processed
_processing_queue: asyncio.Queue = None
# Semaphore: only 1 meeting processed at a time to avoid Claude rate limits
_processing_semaphore: asyncio.Semaphore = None


def _get_semaphore():
    global _processing_semaphore
    if _processing_semaphore is None:
        _processing_semaphore = asyncio.Semaphore(1)
    return _processing_semaphore


@app.get("/")
async def root():
    return {"status": "ok", "service": "claude-meeting-agent"}


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "claude-meeting-agent"}


@app.post("/process-transcript", response_model=ProcessingResult)
async def process_transcript(transcript: TranscriptData, background_tasks: BackgroundTasks):
    """
    Process a meeting transcript asynchronously.
    Returns immediately and processes in background.
    """
    meeting_id = transcript.id

    # Check if already processing
    if meeting_id in processing_status and processing_status[meeting_id].get("status") == "processing":
        raise HTTPException(status_code=409, detail="Meeting is already being processed")

    # Mark as processing
    processing_status[meeting_id] = {"status": "processing", "result": None}

    # Process in background
    background_tasks.add_task(process_transcript_background, transcript.model_dump())

    return ProcessingResult(
        meeting_id=meeting_id,
        title=transcript.title,
        success=True,
        summary="Processing started in background"
    )


NOTION_API_BASE = os.getenv("NOTION_API_BASE", "http://127.0.0.1:8080")
FIREFLY_API_KEY = os.getenv("FIREFLY_API_KEY", "")
ENABLE_DURABLE_RETRY_WORKER = os.getenv("ENABLE_DURABLE_RETRY_WORKER", "true").lower() == "true"
RETRY_POLL_SECONDS = int(os.getenv("RETRY_POLL_SECONDS", "20"))
RATE_LIMIT_COOLDOWN_MINUTES = int(os.getenv("RATE_LIMIT_COOLDOWN_MINUTES", "15"))
BILLING_COOLDOWN_MINUTES = int(os.getenv("BILLING_COOLDOWN_MINUTES", "360"))
AUTH_COOLDOWN_MINUTES = int(os.getenv("AUTH_COOLDOWN_MINUTES", "180"))
# Stronger long-outage retry policy:
# retries quickly at first, then keeps trying forever at wider intervals.
RETRY_BACKOFF_SECONDS = [
    int(v.strip()) for v in os.getenv(
        "RETRY_BACKOFF_SECONDS",
        "60,300,900,3600,21600,43200,86400"
    ).split(",") if v.strip()
]
STALE_REQUEUE_HOURS = int(os.getenv("STALE_REQUEUE_HOURS", "24"))

# Auto-backfill: periodically check Fireflies for meetings the webhook missed
# (e.g. during an outage) and queue them. Skips dates with existing Notion rows
# so manual entries are never duplicated.
ENABLE_AUTO_BACKFILL = os.getenv("ENABLE_AUTO_BACKFILL", "true").lower() == "true"
AUTO_BACKFILL_INTERVAL_HOURS = int(os.getenv("AUTO_BACKFILL_INTERVAL_HOURS", "24"))
AUTO_BACKFILL_LOOKBACK_DAYS = int(os.getenv("AUTO_BACKFILL_LOOKBACK_DAYS", "14"))
AUTO_BACKFILL_INITIAL_DELAY_SECONDS = int(os.getenv("AUTO_BACKFILL_INITIAL_DELAY_SECONDS", "600"))

_retry_worker_task: Optional[asyncio.Task] = None
_auto_backfill_task: Optional[asyncio.Task] = None
_provider_outages: Dict[str, Dict[str, Any]] = {}


async def _append_transcript_to_note(note_id: str, transcript_data: dict):
    """After agent completes, store the raw transcript as a child page in the meeting note."""
    sentences = transcript_data.get("sentences", [])
    if not sentences:
        logger.info("No sentences to append — skipping transcript storage")
        return
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{NOTION_API_BASE}/api/notes/{note_id}/transcript",
                json={
                    "sentences": [
                        {
                            "speaker_name": s.get("speaker_name"),
                            "start_time": s.get("start_time"),
                            "text": s.get("text", ""),
                        }
                        for s in sentences
                    ],
                    "transcript_url": transcript_data.get("transcript_url"),
                },
                timeout=120.0,
            )
            data = resp.json()
            if data.get("success"):
                logger.info(f"Transcript appended: {data.get('blocks_written')} blocks → child page {data.get('child_page_id')}")
            else:
                logger.warning(f"Transcript append returned: {data}")
    except Exception as e:
        logger.warning(f"Transcript append failed (non-critical): {e}")


async def process_transcript_background(transcript_data: dict):
    """Background task to process transcript — queued so only 1 runs at a time."""
    meeting_id = transcript_data["id"]
    sem = _get_semaphore()

    queue_position = sem._value  # 0 = will wait, 1 = runs immediately
    if queue_position == 0:
        logger.info(f"Meeting {meeting_id} queued — another meeting is processing")

    async with sem:
        try:
            logger.info(f"Starting processing for meeting: {meeting_id} - {transcript_data.get('title')}")
            result = await process_meeting_transcript(transcript_data)

            processing_status[meeting_id] = {
                "status": "completed",
                "result": result
            }
            logger.info(f"Completed processing for meeting: {meeting_id}")

            # Auto-append raw transcript as child page inside the meeting note
            note_id = result.get("created_note_id")
            if note_id:
                logger.info(f"Appending transcript to note {note_id}...")
                await _append_transcript_to_note(note_id, transcript_data)
            else:
                logger.warning("No created_note_id in result — transcript not appended")

        except Exception as e:
            logger.error(f"Error processing meeting {meeting_id}: {e}")
            processing_status[meeting_id] = {
                "status": "failed",
                "error": str(e)
            }


def _now_iso() -> str:
    """Return timezone-aware ISO timestamp for durable queue fields."""
    return datetime.now(timezone.utc).isoformat()


def _detect_provider(error_text: str) -> str:
    """Best-effort provider detection for retry classification and service holds."""
    text = (error_text or "").lower()
    if any(marker in text for marker in ["fireflies", "graphql", "transcript fetch", "transcript not found", "firefly_api_key"]):
        return "fireflies"
    if any(marker in text for marker in ["anthropic", "claude", "rate_limit_error", "messages.create", "overloaded_error", "anthropic_api_key"]):
        return "anthropic"
    if any(marker in text for marker in ["provider=notion", "notion", "meeting-register", "api/context", "/api/"]):
        return "notion"
    return "upstream"


def _provider_code(provider: str, suffix: str) -> str:
    prefix = (provider or "upstream").upper().replace("-", "_")
    return f"{prefix}_{suffix}"


def _provider_label(provider: str) -> str:
    return {
        "fireflies": "Fireflies",
        "anthropic": "Anthropic / Claude",
        "notion": "Notion",
        "upstream": "Upstream service",
    }.get(provider, provider.title())


def _extract_retry_after_iso(error_text: str) -> Optional[str]:
    """Extract provider-supplied retry timestamps from human-readable error messages."""
    if not error_text:
        return None

    patterns = [
        r"retry after ([A-Za-z]{3}, \d{1,2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT)",
        r"retry after (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)",
    ]
    for pattern in patterns:
        match = re.search(pattern, error_text, re.IGNORECASE)
        if not match:
            continue
        raw_value = match.group(1).strip()
        try:
            if "GMT" in raw_value:
                parsed = parsedate_to_datetime(raw_value)
            else:
                parsed = datetime.fromisoformat(raw_value.replace("Z", "+00:00"))
            return parsed.astimezone(timezone.utc).isoformat()
        except Exception:
            continue
    return None


def _get_active_provider_outage() -> Optional[Dict[str, Any]]:
    """Return the current provider-wide outage hold, if any, and purge expired holds."""
    now_dt = datetime.now(timezone.utc)
    expired = [
        provider for provider, state in _provider_outages.items()
        if state["until_dt"] <= now_dt
    ]
    for provider in expired:
        del _provider_outages[provider]

    if not _provider_outages:
        return None

    # Any active outage blocks processing because all meetings need the same upstream services.
    return max(_provider_outages.values(), key=lambda state: state["until_dt"])


def _clear_provider_outages() -> List[str]:
    """Clear in-memory provider holds after credits are restored or operator intervention."""
    cleared = list(_provider_outages.keys())
    _provider_outages.clear()
    return cleared


def _register_provider_outage(classification: Dict[str, Any], error_text: str, next_retry_at: Optional[str]) -> Dict[str, Any]:
    """Pause the worker for provider-wide outages like credits/auth/rate limits."""
    provider = classification.get("provider", "upstream")
    until_iso = next_retry_at or _compute_next_retry_iso(0)
    until_dt = datetime.fromisoformat(until_iso.replace("Z", "+00:00"))
    state = {
        "provider": provider,
        "code": classification["code"],
        "message": error_text,
        "until_iso": until_dt.astimezone(timezone.utc).isoformat(),
        "until_dt": until_dt.astimezone(timezone.utc),
    }
    existing = _provider_outages.get(provider)
    if not existing or existing["until_dt"] < state["until_dt"]:
        _provider_outages[provider] = state
    return _provider_outages[provider]


def _build_hold_message(classification: Dict[str, Any], error_text: str, next_retry_at: Optional[str]) -> str:
    provider_label = _provider_label(classification.get("provider", "upstream"))
    if next_retry_at:
        return (
            f"{provider_label} is temporarily unavailable for processing. "
            f"The meeting remains queued and will retry after {next_retry_at}. "
            f"Original error: {error_text}"
        )
    return (
        f"{provider_label} is temporarily unavailable for processing. "
        f"The meeting remains queued until the service recovers. "
        f"Original error: {error_text}"
    )


def _classify_processing_error(error_text: str) -> Dict[str, Any]:
    """
    Classify failures into retryable vs terminal.
    Non-technical explanation:
    - Retryable means "try again later" (network, temporary limits, credit/top-up situations).
    - Terminal means "needs human/config fix" (bad payload/schema/validation).
    """
    text = (error_text or "").lower()
    provider = _detect_provider(error_text)
    retry_after_iso = _extract_retry_after_iso(error_text)
    billing_markers = [
        "credit balance", "credits expired", "insufficient credits",
        "insufficient_quota", "quota exceeded", "quota", "billing", "payment required",
        "payment", "top up", "top-up", "insufficient balance"
    ]
    auth_markers = [
        "unauthorized", "forbidden", "authentication", "invalid api key",
        "invalid token", "api key", "access denied", "401", "403"
    ]
    retryable_markers = [
        "ratelimit", "rate limit", "429", "overloaded", "temporarily unavailable",
        "api connection", "connection reset", "timeout", "network"
    ]
    terminal_markers = [
        "validation", "not found", "400", "schema", "missing required"
    ]
    if any(marker in text for marker in billing_markers):
        return {
            "retryable": True,
            "code": _provider_code(provider, "AWAITING_CREDITS"),
            "provider": provider,
            "cooldown_minutes": BILLING_COOLDOWN_MINUTES,
            "next_retry_at": retry_after_iso,
            "count_retry": False,
            "outage_scope": "provider",
        }
    if any(marker in text for marker in auth_markers):
        return {
            "retryable": True,
            "code": _provider_code(provider, "AUTH_BLOCKED"),
            "provider": provider,
            "cooldown_minutes": AUTH_COOLDOWN_MINUTES,
            "count_retry": False,
            "outage_scope": "provider",
        }
    # Add specific rate limit detection
    if "too many requests" in text or "retry after" in text:
        return {
            "retryable": True,
            "code": _provider_code(provider, "RATE_LIMITED"),
            "provider": provider,
            "cooldown_minutes": RATE_LIMIT_COOLDOWN_MINUTES,
            "next_retry_at": retry_after_iso,
            "count_retry": False,
            "outage_scope": "provider",
        }
    if any(marker in text for marker in retryable_markers):
        return {
            "retryable": True,
            "code": _provider_code(provider, "RETRYABLE_UPSTREAM_LIMIT"),
            "provider": provider,
            "count_retry": True,
        }
    if any(marker in text for marker in terminal_markers):
        return {
            "retryable": False,
            "code": _provider_code(provider, "TERMINAL_VALIDATION"),
            "provider": provider,
            "count_retry": True,
        }
    return {
        "retryable": True,
        "code": _provider_code(provider, "RETRYABLE_UNKNOWN"),
        "provider": provider,
        "count_retry": True,
    }


def _compute_next_retry_iso(retry_count: int) -> str:
    """Compute next retry timestamp with bounded backoff."""
    index = min(max(retry_count, 0), len(RETRY_BACKOFF_SECONDS) - 1)
    next_dt = datetime.now(timezone.utc) + timedelta(seconds=RETRY_BACKOFF_SECONDS[index])
    return next_dt.isoformat()


async def _fetch_meeting_register_rows() -> List[Dict[str, Any]]:
    """Load Meeting Register rows via the bridge API."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{NOTION_API_BASE}/api/meeting-register", timeout=60.0)
            resp.raise_for_status()
            return resp.json() or []
    except Exception as e:
        raise RuntimeError(f"Notion meeting register fetch failed: {e}") from e


async def _patch_meeting_register(row_id: str, payload: Dict[str, Any]) -> None:
    """Patch a single Meeting Register row with queue state updates."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.patch(
                f"{NOTION_API_BASE}/api/meeting-register/{row_id}",
                json=payload,
                timeout=60.0,
            )
            resp.raise_for_status()
    except Exception as e:
        raise RuntimeError(f"Notion meeting register patch failed for {row_id}: {e}") from e


async def _fetch_fireflies_transcript(external_meeting_id: str) -> Dict[str, Any]:
    """Fetch transcript directly from Fireflies for durable retry worker."""
    if not FIREFLY_API_KEY:
        raise RuntimeError("FIREFLY_API_KEY is missing")
    query = """
    query Transcript($transcriptId: String!) {
      transcript(id: $transcriptId) {
        id
        title
        date
        duration
        organizer_email
        participants
        transcript_url
        summary {
          overview
          shorthand_bullet
          action_items
          keywords
        }
        sentences {
          speaker_name
          text
        }
      }
    }
    """
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://api.fireflies.ai/graphql",
            json={"query": query, "variables": {"transcriptId": external_meeting_id}},
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {FIREFLY_API_KEY}",
            },
            timeout=120.0,
        )
        resp.raise_for_status()
        data = resp.json()
    if data.get("errors"):
        error_message = data["errors"][0].get("message", "Fireflies query failed")
        logger.warning(
            f"Fireflies transcript fetch returned GraphQL errors for {external_meeting_id}: {data['errors']}"
        )
        raise RuntimeError(f"Fireflies transcript fetch failed: {error_message}")
    transcript = (data.get("data") or {}).get("transcript")
    if not transcript:
        raise RuntimeError("Fireflies transcript not found")
    raw_date = transcript.get("date")
    if isinstance(raw_date, (int, float)):
        transcript["date"] = datetime.fromtimestamp(raw_date / 1000, tz=timezone.utc).isoformat()
    return transcript


async def _list_fireflies_transcripts(page_size: int = 50, max_pages: int = 4) -> List[Dict[str, Any]]:
    """List recent Fireflies transcripts (id, title, date, duration), paginated."""
    if not FIREFLY_API_KEY:
        raise RuntimeError("FIREFLY_API_KEY is missing")
    query = """
    query Transcripts($limit: Int, $skip: Int) {
      transcripts(limit: $limit, skip: $skip) { id title date duration }
    }
    """
    all_transcripts: List[Dict[str, Any]] = []
    skip = 0
    async with httpx.AsyncClient() as client:
        for _ in range(max_pages):
            resp = await client.post(
                "https://api.fireflies.ai/graphql",
                json={"query": query, "variables": {"limit": page_size, "skip": skip}},
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {FIREFLY_API_KEY}",
                },
                timeout=60.0,
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("errors"):
                err = data["errors"][0]
                raise RuntimeError(f"Fireflies list failed: {err.get('message', 'unknown')}")
            batch = (data.get("data") or {}).get("transcripts") or []
            if not batch:
                break
            all_transcripts.extend(batch)
            if len(batch) < page_size:
                break
            skip += page_size
    return all_transcripts


def _coerce_iso_date(raw: Any) -> Optional[str]:
    """Return YYYY-MM-DD for a Fireflies date value (ms epoch or ISO string)."""
    if raw is None:
        return None
    try:
        if isinstance(raw, (int, float)):
            return datetime.fromtimestamp(raw / 1000, tz=timezone.utc).date().isoformat()
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00")).date().isoformat()
    except Exception:
        return None


async def _queue_meeting_for_backfill(transcript: Dict[str, Any]) -> None:
    """Queue a missing Fireflies meeting via the upsert endpoint."""
    meeting_date = _coerce_iso_date(transcript.get("date")) or datetime.now(timezone.utc).date().isoformat()
    payload = {
        "externalMeetingId": transcript["id"],
        "meetingFormat": "Virtual",
        "processingStatus": "Pending",
        "retryCount": 0,
        "retrySource": "auto_backfill",
        "nextRetryAt": _now_iso(),
        "forceRerun": False,
        "createOnlyFields": {
            "title": transcript.get("title") or "Untitled Meeting",
            "meetingDate": meeting_date,
        },
    }
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{NOTION_API_BASE}/api/meeting-register/upsert-by-external",
            json=payload,
            timeout=30.0,
        )
        resp.raise_for_status()


async def _run_auto_backfill_pass() -> Dict[str, int]:
    """Find Fireflies meetings missing from Notion and queue them.

    Skips Fireflies meetings whose date already has any Notion row, so manual
    entries are never duplicated. Only true gaps (typically: webhooks lost
    during a Fireflies outage) are backfilled.
    """
    cutoff_dt = datetime.now(timezone.utc) - timedelta(days=AUTO_BACKFILL_LOOKBACK_DAYS)
    transcripts = await _list_fireflies_transcripts()

    rows = await _fetch_meeting_register_rows()
    existing_ext_ids = {(r.get("externalMeetingId") or "").strip() for r in rows if r.get("externalMeetingId")}
    existing_dates = {(r.get("meetingDate") or "")[:10] for r in rows if r.get("meetingDate")}

    queued = 0
    skipped_existing_id = 0
    skipped_existing_date = 0
    skipped_too_old = 0
    failed = 0
    for t in transcripts:
        iso_date = _coerce_iso_date(t.get("date"))
        if iso_date and datetime.fromisoformat(iso_date).replace(tzinfo=timezone.utc) < cutoff_dt:
            skipped_too_old += 1
            continue
        if t.get("id") in existing_ext_ids:
            skipped_existing_id += 1
            continue
        if iso_date and iso_date in existing_dates:
            skipped_existing_date += 1
            continue
        try:
            await _queue_meeting_for_backfill(t)
            queued += 1
            logger.info(f"Auto-backfill queued {t.get('id')} ({iso_date}) {t.get('title')}")
        except Exception as e:
            failed += 1
            logger.warning(f"Auto-backfill failed for {t.get('id')}: {e}")
    return {
        "queued": queued,
        "skipped_existing_id": skipped_existing_id,
        "skipped_existing_date": skipped_existing_date,
        "skipped_too_old": skipped_too_old,
        "failed": failed,
        "total_seen": len(transcripts),
    }


async def _auto_backfill_loop():
    """Periodic discovery: queue Fireflies meetings the webhook missed."""
    logger.info(
        f"Auto-backfill loop started (interval={AUTO_BACKFILL_INTERVAL_HOURS}h, "
        f"lookback={AUTO_BACKFILL_LOOKBACK_DAYS}d)"
    )
    await asyncio.sleep(AUTO_BACKFILL_INITIAL_DELAY_SECONDS)
    while True:
        try:
            outage = _get_active_provider_outage()
            if outage:
                logger.info(
                    f"Auto-backfill skipped — {outage.get('provider')} hold active until "
                    f"{outage.get('until_iso')}"
                )
            else:
                stats = await _run_auto_backfill_pass()
                logger.info(f"Auto-backfill cycle complete: {stats}")
        except Exception as e:
            logger.warning(f"Auto-backfill cycle failed: {e}")
        await asyncio.sleep(AUTO_BACKFILL_INTERVAL_HOURS * 3600)


async def _fetch_cached_transcript(row_id: str) -> Optional[Dict[str, Any]]:
    """Load a cached transcript snapshot from the Meeting Register row if available."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{NOTION_API_BASE}/api/meeting-register/{row_id}/transcript-cache",
                timeout=60.0,
            )
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            payload = resp.json() or {}
            transcript = payload.get("transcript")
            if transcript:
                logger.info(
                    f"Loaded cached transcript snapshot for meeting register {row_id} "
                    f"({len(transcript.get('sentences', []))} sentences)"
                )
            return transcript
    except Exception as e:
        raise RuntimeError(f"Transcript cache lookup failed for {row_id}: {e}") from e


async def _store_cached_transcript(row_id: str, transcript: Dict[str, Any]) -> None:
    """Persist a transcript snapshot on the Meeting Register row for future autonomous retries."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{NOTION_API_BASE}/api/meeting-register/{row_id}/transcript-cache",
                json=transcript,
                timeout=120.0,
            )
            resp.raise_for_status()
    except Exception as e:
        raise RuntimeError(f"Transcript cache store failed for {row_id}: {e}") from e


def _is_due_for_retry(row: Dict[str, Any], now_dt: datetime) -> bool:
    """Check if the row should be attempted right now."""
    status = (row.get("processingStatus") or "").strip()
    if status not in {"Pending", "Failed", "Processing"}:
        return False

    # Terminal Failed rows (404, validation, max retries) require explicit
    # forceRerun to come back. Without this, a 404 from Fireflies sets
    # nextRetryAt=None and the worker would re-fire on every poll, burning
    # the upstream rate-limit budget.
    if status == "Failed" and not bool(row.get("forceRerun")):
        return False

    next_retry = row.get("nextRetryAt")
    if not next_retry:
        return True
    try:
        due_dt = datetime.fromisoformat(next_retry.replace("Z", "+00:00"))
        return due_dt <= now_dt
    except Exception:
        return True


def _is_stale_unprocessed_row(row: Dict[str, Any], now_dt: datetime) -> bool:
    """
    Detect rows stuck for too long without a successful process.
    Non-technical behavior: if a meeting has not finished for a long time,
    the worker puts it back into the retry line automatically.
    """
    if row.get("processedAt"):
        return False
    if not row.get("externalMeetingId"):
        return False

    status = (row.get("processingStatus") or "").strip()
    # Failed rows are terminal until an operator sets forceRerun — never auto-requeue
    # them, otherwise a 404/validation error becomes an infinite retry loop.
    if status not in {"Pending", "Processing", "Not started", "Speaker Review"}:
        return False

    # Prefer last attempt timestamp; fall back to meeting date if needed.
    reference = row.get("lastAttemptAt") or row.get("nextRetryAt") or row.get("meetingDate")
    if not reference:
        return True
    try:
        ref_dt = datetime.fromisoformat(reference.replace("Z", "+00:00"))
    except Exception:
        return True
    age_hours = (now_dt - ref_dt).total_seconds() / 3600
    return age_hours >= STALE_REQUEUE_HOURS


async def _pause_row_for_outage(row: Dict[str, Any], outage: Dict[str, Any]) -> None:
    """Move due rows behind the active provider hold without consuming retry attempts."""
    if (
        row.get("nextRetryAt") == outage["until_iso"]
        and row.get("lastErrorCode") == outage["code"]
    ):
        return

    await _patch_meeting_register(row["id"], {
        "processingStatus": "Pending",
        "nextRetryAt": outage["until_iso"],
        "lastErrorCode": outage["code"],
        "lastErrorMessage": _build_hold_message(
            {"provider": outage["provider"]},
            outage["message"],
            outage["until_iso"],
        ),
        "retrySource": f"{outage['provider']}_service_hold",
    })


async def _process_retry_row(row: Dict[str, Any]) -> None:
    """
    Process one queued row end-to-end.
    Prevents duplicate writes by skipping if already completed unless force rerun is enabled.
    """
    row_id = row["id"]
    external_id = row.get("externalMeetingId")
    retry_count = int(row.get("retryCount") or 0)
    force_rerun = bool(row.get("forceRerun"))
    processed_at = row.get("processedAt")
    created_note_id = row.get("createdNoteId")
    
    # Max retry attempts protection
    max_retry_attempts = int(os.getenv("MAX_RETRY_ATTEMPTS", "100"))
    if retry_count >= max_retry_attempts and not force_rerun:
        await _patch_meeting_register(row_id, {
            "processingStatus": "Failed",
            "lastErrorCode": "MAX_RETRIES_EXCEEDED",
            "lastErrorMessage": f"Maximum retry attempts ({max_retry_attempts}) exceeded. Manual intervention required.",
            "nextRetryAt": None,
        })
        logger.warning(f"Meeting {row_id} exceeded max retry attempts ({retry_count}), marking as failed")
        return

    # Strict idempotency gate:
    # If already processed and no explicit force rerun, skip to avoid duplicate notes/agendas.
    if processed_at and created_note_id and not force_rerun:
        await _patch_meeting_register(row_id, {
            "processingStatus": "Completed",
            "lastErrorCode": "",
            "lastErrorMessage": "",
            "nextRetryAt": None,
        })
        return

    await _patch_meeting_register(row_id, {
        "processingStatus": "Processing",
        "lastAttemptAt": _now_iso(),
        "lastErrorCode": "",
        "lastErrorMessage": "",
    })

    try:
        if not external_id:
            # Phrased to match terminal_markers ("missing required") so this
            # classifies as terminal rather than RETRYABLE_UNKNOWN — a row with
            # no external ID will never succeed on its own and needs operator fix.
            raise RuntimeError("Missing required external meeting id")
        transcript = await _fetch_cached_transcript(row_id)
        if transcript:
            logger.info(f"Using cached transcript snapshot for meeting {row_id}; Fireflies fetch skipped")
        else:
            logger.info(f"No cached transcript snapshot for meeting {row_id}; fetching from Fireflies")
            transcript = await _fetch_fireflies_transcript(external_id)
            try:
                await _store_cached_transcript(row_id, transcript)
                logger.info(f"Stored transcript snapshot for meeting {row_id} after Fireflies fallback fetch")
            except Exception as cache_error:
                logger.warning(
                    f"Transcript cache store failed for meeting {row_id}; "
                    f"future retries may still need Fireflies. Error: {cache_error}"
                )
        result = await process_meeting_transcript(transcript)
        if not result.get("success"):
            raise RuntimeError(result.get("error") or "Unknown processing error")

        await _patch_meeting_register(row_id, {
            "processingStatus": "Completed",
            "processedAt": _now_iso(),
            "nextRetryAt": None,
            "lastErrorCode": "",
            "lastErrorMessage": "",
            "createdNoteId": result.get("created_note_id"),
            "retryCount": retry_count,
            "forceRerun": False,
        })
    except Exception as e:
        error_text = str(e)
        classification = _classify_processing_error(error_text)

        retry_increment = 1 if classification.get("count_retry", True) else 0
        next_retry = classification.get("next_retry_at")
        if classification.get("outage_scope") == "provider":
            if not next_retry:
                cooldown_minutes = classification.get("cooldown_minutes", RATE_LIMIT_COOLDOWN_MINUTES)
                next_retry_dt = datetime.now(timezone.utc) + timedelta(minutes=cooldown_minutes)
                next_retry = next_retry_dt.isoformat()
            outage = _register_provider_outage(classification, error_text, next_retry)
            next_retry = outage["until_iso"]
            hold_message = _build_hold_message(classification, error_text, next_retry)
            logger.warning(
                f"{_provider_label(classification.get('provider', 'upstream'))} outage detected for meeting {row_id}. "
                f"Retry paused until {next_retry}. Error: {error_text}"
            )
        else:
            hold_message = error_text
            next_retry = next_retry or (_compute_next_retry_iso(retry_count + 1) if classification["retryable"] else None)
            logger.warning(
                f"Meeting {row_id} processing failed with {classification['code']}: {error_text}"
            )

        await _patch_meeting_register(row_id, {
            "processingStatus": "Pending" if classification["retryable"] else "Failed",
            "retryCount": retry_count + retry_increment,
            "nextRetryAt": next_retry,
            "lastErrorCode": classification["code"],
            "lastErrorMessage": hold_message,
            "retrySource": (
                f"{classification.get('provider', 'upstream')}_service_hold"
                if classification.get("outage_scope") == "provider"
                else row.get("retrySource")
            ),
        })


async def _retry_worker_loop():
    """Background durable retry worker."""
    logger.info("Durable retry worker started")
    while True:
        try:
            active_outage = _get_active_provider_outage()
            if active_outage and active_outage["provider"] == "notion":
                logger.warning(
                    f"Skipping retry cycle while {_provider_label(active_outage['provider'])} is paused "
                    f"until {active_outage['until_iso']}"
                )
                await asyncio.sleep(RETRY_POLL_SECONDS)
                continue

            rows = await _fetch_meeting_register_rows()
            now_dt = datetime.now(timezone.utc)

            # Self-heal stale/unprocessed rows first.
            stale_rows = [row for row in rows if _is_stale_unprocessed_row(row, now_dt)]
            for row in stale_rows:
                await _patch_meeting_register(row["id"], {
                    "processingStatus": "Pending",
                    "nextRetryAt": _now_iso(),
                    "retrySource": "stale_auto_requeue",
                })
            if stale_rows:
                logger.info(f"Retry worker auto-requeued {len(stale_rows)} stale meeting(s)")

            # Refresh list after stale updates so selection reflects latest state.
            if stale_rows:
                rows = await _fetch_meeting_register_rows()

            due_rows = [row for row in rows if _is_due_for_retry(row, now_dt)]
            if due_rows:
                logger.info(f"Retry worker found {len(due_rows)} due meeting(s)")
            active_outage = _get_active_provider_outage()
            if active_outage and due_rows:
                logger.warning(
                    f"Deferring {len(due_rows)} due meeting(s) while {_provider_label(active_outage['provider'])} "
                    f"is paused until {active_outage['until_iso']}"
                )
                for row in due_rows:
                    await _pause_row_for_outage(row, active_outage)
                await asyncio.sleep(RETRY_POLL_SECONDS)
                continue
            for row in due_rows:
                active_outage = _get_active_provider_outage()
                if active_outage:
                    await _pause_row_for_outage(row, active_outage)
                    continue
                await _process_retry_row(row)
        except Exception as loop_error:
            error_text = str(loop_error)
            classification = _classify_processing_error(error_text)
            if classification.get("outage_scope") == "provider":
                next_retry = classification.get("next_retry_at")
                if not next_retry:
                    cooldown_minutes = classification.get("cooldown_minutes", RATE_LIMIT_COOLDOWN_MINUTES)
                    next_retry = (datetime.now(timezone.utc) + timedelta(minutes=cooldown_minutes)).isoformat()
                outage = _register_provider_outage(classification, error_text, next_retry)
                logger.error(
                    f"Retry worker loop paused by {_provider_label(outage['provider'])} outage until "
                    f"{outage['until_iso']}: {error_text}"
                )
            else:
                logger.error(f"Retry worker loop error: {loop_error}")
        await asyncio.sleep(RETRY_POLL_SECONDS)


@app.get("/status/{meeting_id}")
async def get_processing_status(meeting_id: str):
    """Check the processing status of a meeting."""
    if meeting_id not in processing_status:
        raise HTTPException(status_code=404, detail="Meeting not found")

    return processing_status[meeting_id]


@app.post("/worker/retry-pending-now")
async def retry_pending_now():
    """Operator endpoint: force all pending rows to retry immediately."""
    cleared_outages = _clear_provider_outages()
    rows = await _fetch_meeting_register_rows()
    updated = 0
    for row in rows:
        status = (row.get("processingStatus") or "").strip()
        if status in {"Pending", "Failed"}:
            await _patch_meeting_register(row["id"], {"nextRetryAt": _now_iso(), "processingStatus": "Pending"})
            updated += 1
    return {"success": True, "updated": updated, "clearedOutages": cleared_outages}


@app.get("/worker/outages")
async def get_worker_outages():
    """Show active provider holds so operators can see why retries are paused."""
    active = _get_active_provider_outage()
    if not active:
        return {"active": []}
    return {"active": [{
        "provider": active["provider"],
        "code": active["code"],
        "until": active["until_iso"],
        "message": active["message"],
    }]}


@app.post("/worker/retry-meeting/{external_meeting_id}")
async def retry_one_meeting(external_meeting_id: str):
    """Operator endpoint: retry one specific meeting by external meeting id."""
    async with httpx.AsyncClient() as client:
        lookup = await client.get(f"{NOTION_API_BASE}/api/meeting-register/by-external/{external_meeting_id}", timeout=30.0)
    if lookup.status_code == 404:
        raise HTTPException(status_code=404, detail="Meeting register row not found")
    lookup.raise_for_status()
    row_id = lookup.json()["id"]
    await _patch_meeting_register(row_id, {"nextRetryAt": _now_iso(), "processingStatus": "Pending"})
    return {"success": True, "id": row_id}


@app.post("/worker/force-rerun/{external_meeting_id}")
async def force_rerun_meeting(external_meeting_id: str):
    """Operator endpoint: explicit force rerun (bypasses strict idempotency guard once)."""
    async with httpx.AsyncClient() as client:
        lookup = await client.get(f"{NOTION_API_BASE}/api/meeting-register/by-external/{external_meeting_id}", timeout=30.0)
    if lookup.status_code == 404:
        raise HTTPException(status_code=404, detail="Meeting register row not found")
    lookup.raise_for_status()
    row_id = lookup.json()["id"]
    await _patch_meeting_register(row_id, {
        "forceRerun": True,
        "nextRetryAt": _now_iso(),
        "processingStatus": "Pending",
    })
    return {"success": True, "id": row_id}


@app.post("/process-transcript-sync", response_model=ProcessingResult)
async def process_transcript_sync(transcript: TranscriptData):
    """
    Process a meeting transcript synchronously.
    Waits for completion before returning.
    Use for testing or when immediate response is needed.
    """
    try:
        result = await process_meeting_transcript(transcript.model_dump())

        return ProcessingResult(
            meeting_id=transcript.id,
            title=transcript.title,
            success=result["success"],
            error=result.get("error"),
            summary=result.get("summary", f"Processed {len(result.get('messages', []))} messages")
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/cost-summary")
async def get_cost_summary():
    """Aggregate cost summary across all processed meetings."""
    completed = [
        entry["result"] for entry in processing_status.values()
        if entry.get("status") == "completed" and entry.get("result")
    ]

    total_cost = 0.0
    total_cache_savings = 0.0
    by_method = {"standard": 0, "two_pass": 0}
    by_model = {}

    for result in completed:
        cost = result.get("cost_analysis", {})
        total_cost += cost.get("total_cost_usd", 0)
        total_cache_savings += cost.get("cache_savings_usd", 0)

        method = result.get("processing_method", "standard")
        by_method[method] = by_method.get(method, 0) + 1

        model = result.get("model_used", "unknown")
        if model not in by_model:
            by_model[model] = {"count": 0, "cost": 0.0}
        by_model[model]["count"] += 1
        by_model[model]["cost"] += cost.get("total_cost_usd", 0)

    return {
        "meetings_processed": len(completed),
        "total_cost_usd": round(total_cost, 4),
        "total_cache_savings_usd": round(total_cache_savings, 4),
        "average_cost_per_meeting": round(total_cost / max(len(completed), 1), 4),
        "by_processing_method": by_method,
        "by_model": by_model,
    }


@app.on_event("startup")
async def start_retry_worker():
    """Start durable retry loop and auto-backfill loop on server boot (feature-flagged)."""
    global _retry_worker_task, _auto_backfill_task
    if ENABLE_DURABLE_RETRY_WORKER and _retry_worker_task is None:
        _retry_worker_task = asyncio.create_task(_retry_worker_loop())
        logger.info("Durable retry worker enabled")
    if ENABLE_AUTO_BACKFILL and _auto_backfill_task is None:
        _auto_backfill_task = asyncio.create_task(_auto_backfill_loop())
        logger.info("Auto-backfill loop enabled")


@app.on_event("shutdown")
async def stop_retry_worker():
    """Stop background loops on shutdown."""
    global _retry_worker_task, _auto_backfill_task
    if _retry_worker_task:
        _retry_worker_task.cancel()
        _retry_worker_task = None
    if _auto_backfill_task:
        _auto_backfill_task.cancel()
        _auto_backfill_task = None
