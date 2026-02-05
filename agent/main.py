from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import logging
import os
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


class TranscriptSummary(BaseModel):
    overview: Optional[str] = None
    action_items: Optional[List[str]] = []
    shorthand_bullet: Optional[List[str]] = []
    keywords: Optional[List[str]] = []


class Sentence(BaseModel):
    speaker_name: str
    text: str


class TranscriptData(BaseModel):
    id: str
    title: str
    date: Optional[str] = None
    duration: Optional[int] = 0
    summary: Optional[TranscriptSummary] = None
    sentences: Optional[List[Sentence]] = []
    transcript_url: Optional[str] = None
    organizer_email: Optional[str] = None
    participants: Optional[List[str]] = []


class ProcessingResult(BaseModel):
    meeting_id: str
    title: str
    success: bool
    error: Optional[str] = None
    summary: Optional[str] = None


# In-memory processing status (use Redis/DB in production)
processing_status: Dict[str, Any] = {}


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


async def process_transcript_background(transcript_data: dict):
    """Background task to process transcript."""
    meeting_id = transcript_data["id"]

    try:
        logger.info(f"Starting processing for meeting: {meeting_id} - {transcript_data.get('title')}")
        result = await process_meeting_transcript(transcript_data)

        processing_status[meeting_id] = {
            "status": "completed",
            "result": result
        }
        logger.info(f"Completed processing for meeting: {meeting_id}")

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
