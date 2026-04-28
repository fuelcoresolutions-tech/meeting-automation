from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator
from typing import Optional, List, Dict, Any, Union
from datetime import datetime
import asyncio
import logging
import os
import traceback
import httpx
from datetime import timezone, timedelta
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
# Stronger long-outage retry policy:
# retries quickly at first, then keeps trying forever at wider intervals.
RETRY_BACKOFF_SECONDS = [
    int(v.strip()) for v in os.getenv(
        "RETRY_BACKOFF_SECONDS",
        "60,300,900,3600,21600,43200,86400"
    ).split(",") if v.strip()
]
STALE_REQUEUE_HOURS = int(os.getenv("STALE_REQUEUE_HOURS", "24"))
_retry_worker_task: Optional[asyncio.Task] = None


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


def _classify_processing_error(error_text: str) -> Dict[str, Any]:
    """
    Classify failures into retryable vs terminal.
    Non-technical explanation:
    - Retryable means "try again later" (network, temporary limits, credit/top-up situations).
    - Terminal means "needs human/config fix" (bad payload/schema/validation).
    """
    text = (error_text or "").lower()
    retryable_markers = [
        "ratelimit", "rate limit", "429", "overloaded", "temporarily unavailable",
        "api connection", "connection reset", "timeout", "network",
        "credit", "quota", "insufficient", "billing", "payment"
    ]
    terminal_markers = [
        "validation", "invalid", "not found", "400", "401", "403", "schema", "missing required"
    ]
    # Add specific rate limit detection
    if "too many requests" in text or "retry after" in text:
        return {
            "retryable": True,
            "code": "RATE_LIMITED",
            "cooldown_minutes": RATE_LIMIT_COOLDOWN_MINUTES,
        }
    if any(marker in text for marker in retryable_markers):
        return {"retryable": True, "code": "RETRYABLE_UPSTREAM_LIMIT"}
    if any(marker in text for marker in terminal_markers):
        return {"retryable": False, "code": "TERMINAL_VALIDATION"}
    return {"retryable": True, "code": "RETRYABLE_UNKNOWN"}


def _compute_next_retry_iso(retry_count: int) -> str:
    """Compute next retry timestamp with bounded backoff."""
    index = min(max(retry_count, 0), len(RETRY_BACKOFF_SECONDS) - 1)
    next_dt = datetime.now(timezone.utc) + timedelta(seconds=RETRY_BACKOFF_SECONDS[index])
    return next_dt.isoformat()


async def _fetch_meeting_register_rows() -> List[Dict[str, Any]]:
    """Load Meeting Register rows via the bridge API."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{NOTION_API_BASE}/api/meeting-register", timeout=60.0)
        resp.raise_for_status()
        return resp.json() or []


async def _patch_meeting_register(row_id: str, payload: Dict[str, Any]) -> None:
    """Patch a single Meeting Register row with queue state updates."""
    async with httpx.AsyncClient() as client:
        resp = await client.patch(
            f"{NOTION_API_BASE}/api/meeting-register/{row_id}",
            json=payload,
            timeout=60.0,
        )
        resp.raise_for_status()


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
        raise RuntimeError(error_message)
    transcript = (data.get("data") or {}).get("transcript")
    if not transcript:
        raise RuntimeError("Transcript not found")
    raw_date = transcript.get("date")
    if isinstance(raw_date, (int, float)):
        transcript["date"] = datetime.fromtimestamp(raw_date / 1000, tz=timezone.utc).isoformat()
    return transcript


def _is_due_for_retry(row: Dict[str, Any], now_dt: datetime) -> bool:
    """Check if the row should be attempted right now."""
    status = (row.get("processingStatus") or "").strip()
    if status not in {"Pending", "Failed", "Processing"}:
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
    # Include states that can get stuck during outages or manual transitions.
    if status not in {"Pending", "Failed", "Processing", "Not started", "Speaker Review"}:
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
            raise RuntimeError("Missing external meeting id")
        transcript = await _fetch_fireflies_transcript(external_id)
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
        
        # Handle rate limits with extended cooldown
        if classification.get("code") == "RATE_LIMITED":
            cooldown_minutes = classification.get("cooldown_minutes", RATE_LIMIT_COOLDOWN_MINUTES)
            next_retry_dt = datetime.now(timezone.utc) + timedelta(minutes=cooldown_minutes)
            next_retry = next_retry_dt.isoformat()
            logger.warning(
                f"Rate limit detected for meeting {row_id}, cooling down for "
                f"{cooldown_minutes} minute(s). Error: {error_text}"
            )
        else:
            next_retry = _compute_next_retry_iso(retry_count + 1) if classification["retryable"] else None
            logger.warning(
                f"Meeting {row_id} processing failed with {classification['code']}: {error_text}"
            )
            
        await _patch_meeting_register(row_id, {
            "processingStatus": "Pending" if classification["retryable"] else "Failed",
            "retryCount": retry_count + 1,
            "nextRetryAt": next_retry,
            "lastErrorCode": classification["code"],
            "lastErrorMessage": error_text,
        })


async def _retry_worker_loop():
    """Background durable retry worker."""
    logger.info("Durable retry worker started")
    while True:
        try:
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
            for row in due_rows:
                await _process_retry_row(row)
        except Exception as loop_error:
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
    rows = await _fetch_meeting_register_rows()
    updated = 0
    for row in rows:
        status = (row.get("processingStatus") or "").strip()
        if status in {"Pending", "Failed"}:
            await _patch_meeting_register(row["id"], {"nextRetryAt": _now_iso(), "processingStatus": "Pending"})
            updated += 1
    return {"success": True, "updated": updated}


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
    """Start durable retry loop on server boot (feature-flagged)."""
    global _retry_worker_task
    if ENABLE_DURABLE_RETRY_WORKER and _retry_worker_task is None:
        _retry_worker_task = asyncio.create_task(_retry_worker_loop())
        logger.info("Durable retry worker enabled")


@app.on_event("shutdown")
async def stop_retry_worker():
    """Stop durable retry loop on shutdown."""
    global _retry_worker_task
    if _retry_worker_task:
        _retry_worker_task.cancel()
        _retry_worker_task = None
