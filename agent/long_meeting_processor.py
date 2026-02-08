import os
import logging
from anthropic import Anthropic
from typing import List, Dict, Tuple

logger = logging.getLogger(__name__)

HAIKU_MODEL = os.getenv("CLAUDE_HAIKU_MODEL", "claude-haiku-4-5-20251001")

EXTRACTION_PROMPT = """Extract ALL of the following from this meeting segment. Be thorough — do not skip anything:

1. **Action items**: Who needs to do what, with any mentioned deadlines
2. **Decisions made**: What was decided and the rationale
3. **Key discussion points**: Main topics and important context
4. **Issues raised**: Problems, blockers, or concerns mentioned
5. **Rocks/priorities**: Any quarterly goals or strategic priorities discussed

Be concise but comprehensive. Use bullet points. Preserve speaker names and specific details."""

MAX_TOKENS_PER_CHUNK = 15000


def estimate_tokens(text: str) -> int:
    """Estimate token count using character heuristic (1 token ≈ 4 chars)."""
    return len(text) // 4


def chunk_transcript(sentences: List[Dict], max_tokens_per_chunk: int = MAX_TOKENS_PER_CHUNK) -> List[str]:
    """Split transcript sentences into token-bounded chunks."""
    chunks = []
    current_lines = []
    current_tokens = 0

    for s in sentences:
        speaker = s.get('speaker_name') or 'Speaker'
        text = s.get('text', '')
        line = f"**{speaker}**: {text}"
        line_tokens = estimate_tokens(line)

        if current_tokens + line_tokens > max_tokens_per_chunk and current_lines:
            chunks.append('\n'.join(current_lines))
            current_lines = []
            current_tokens = 0

        current_lines.append(line)
        current_tokens += line_tokens

    if current_lines:
        chunks.append('\n'.join(current_lines))

    return chunks


def extract_from_chunk(client: Anthropic, chunk: str, chunk_num: int, total_chunks: int) -> Tuple[str, dict]:
    """Use Haiku to extract key info from a single transcript chunk.

    Returns (extracted_text, usage_dict).
    """
    response = client.messages.create(
        model=HAIKU_MODEL,
        max_tokens=2048,
        system="You are a meeting analyst. Extract actionable information concisely and thoroughly.",
        messages=[{
            "role": "user",
            "content": f"Meeting Transcript — Segment {chunk_num} of {total_chunks}:\n\n{chunk}\n\n{EXTRACTION_PROMPT}"
        }]
    )

    usage = {
        "input_tokens": response.usage.input_tokens,
        "output_tokens": response.usage.output_tokens,
    }

    haiku_cost = (usage["input_tokens"] * 1.0 + usage["output_tokens"] * 5.0) / 1_000_000
    logger.info(f"Chunk {chunk_num}/{total_chunks} extraction — {usage['input_tokens']} in / {usage['output_tokens']} out — ${haiku_cost:.4f}")

    return response.content[0].text, usage


def process_long_meeting(client: Anthropic, sentences: List[Dict]) -> dict:
    """Process a long meeting transcript using chunked Haiku extraction.

    Returns dict with:
      - extracted_content: combined briefing text
      - num_chunks: how many chunks were processed
      - haiku_usage: aggregated token usage from extraction pass
    """
    chunks = chunk_transcript(sentences)
    logger.info(f"Split long transcript into {len(chunks)} chunks")

    extracted_sections = []
    total_usage = {"input_tokens": 0, "output_tokens": 0}

    for i, chunk in enumerate(chunks, 1):
        extraction, usage = extract_from_chunk(client, chunk, i, len(chunks))
        extracted_sections.append(f"### Segment {i} of {len(chunks)}\n{extraction}")
        total_usage["input_tokens"] += usage["input_tokens"]
        total_usage["output_tokens"] += usage["output_tokens"]

    combined = "\n\n".join(extracted_sections)
    total_haiku_cost = (total_usage["input_tokens"] * 1.0 + total_usage["output_tokens"] * 5.0) / 1_000_000
    logger.info(f"Extraction complete — {len(chunks)} chunks — total Haiku cost: ${total_haiku_cost:.4f}")

    return {
        "extracted_content": combined,
        "num_chunks": len(chunks),
        "haiku_usage": total_usage,
        "haiku_cost": total_haiku_cost,
    }
