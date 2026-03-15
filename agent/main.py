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
from dotenv import load_dotenv

# Load environment variables from parent directory
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

from claude_agent import process_meeting_transcript

logging.basicConfig(level=logging.INFO)
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


@app.get("/status/{meeting_id}")
async def get_processing_status(meeting_id: str):
    """Check the processing status of a meeting."""
    if meeting_id not in processing_status:
        raise HTTPException(status_code=404, detail="Meeting not found")

    return processing_status[meeting_id]


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
