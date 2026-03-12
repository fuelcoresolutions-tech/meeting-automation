import os
import logging
from anthropic import Anthropic
from typing import List, Dict, Tuple, Optional

logger = logging.getLogger(__name__)

SONNET_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-20250514")

EXTRACTION_PROMPT = """Extract ALL of the following from this meeting segment. Be thorough — do not skip anything:

1. **Action items**: Who needs to do what, with any mentioned deadlines
2. **Decisions made**: What was decided and the rationale
3. **Key discussion points**: Main topics and important context
4. **Issues raised**: Problems, blockers, or concerns mentioned
5. **Rocks/priorities**: Any quarterly goals or strategic priorities discussed

CRITICAL: Preserve ALL proper nouns, company names, and speaker names EXACTLY as they appear in the transcript.
Do NOT "correct" or substitute names. If the transcript says "Stabex", write "Stabex" — NOT "Starbucks".
Be concise but comprehensive. Use bullet points."""

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


def extract_from_chunk(client: Anthropic, chunk: str, chunk_num: int, total_chunks: int, context_brief: str = "") -> Tuple[str, dict]:
    """Use Haiku to extract key info from a single transcript chunk.

    Returns (extracted_text, usage_dict).
    """
    system_prompt = (
        "You are a meeting analyst for FUEL CORE SOLUTIONS, a pump equipment and fuel systems company in Uganda.\n\n"
        "CRITICAL NAME PRESERVATION RULES:\n"
        "- The company 'Stabex' is a CLIENT — it is NOT 'Starbucks'. NEVER change Stabex to Starbucks.\n"
        "- Preserve ALL proper nouns exactly as spoken: company names, people names, place names.\n"
        "- Do NOT auto-correct or substitute any names. If unsure, keep the original spelling.\n\n"
        "KNOWN ENTITIES:\n"
        "- Fuel Core Solutions = the company holding this meeting\n"
        "- Stabex = major client (pump sales, gas cylinders, lubricants, fueling stations)\n"
        "- Chambogo = a station/location\n"
        "- Lexor Group = consulting firm (Bob Changamu works there)\n"
        "- Known people: John Mark Kimuli, Lawrence, Ruth Daniels, Brian Kipchirchir, Dan, Annet, Robert, Bob Changamu\n"
    )
    if context_brief:
        system_prompt += f"\nADDITIONAL CONTEXT:\n{context_brief}\n"
    system_prompt += "\nExtract actionable information concisely and thoroughly. Preserve all names exactly."

    response = client.messages.create(
        model=SONNET_MODEL,
        max_tokens=2048,
        system=system_prompt,
        messages=[{
            "role": "user",
            "content": f"Meeting Transcript — Segment {chunk_num} of {total_chunks}:\n\n{chunk}\n\n{EXTRACTION_PROMPT}"
        }]
    )

    usage = {
        "input_tokens": response.usage.input_tokens,
        "output_tokens": response.usage.output_tokens,
    }

    cost = (usage["input_tokens"] * 3.0 + usage["output_tokens"] * 15.0) / 1_000_000
    logger.info(f"Chunk {chunk_num}/{total_chunks} extraction (Sonnet) — {usage['input_tokens']} in / {usage['output_tokens']} out — ${cost:.4f}")

    return response.content[0].text, usage


def process_long_meeting(client: Anthropic, sentences: List[Dict], context_brief: str = "") -> dict:
    """Process a long meeting transcript using chunked Haiku extraction.

    Args:
        context_brief: Optional brief context string (rock titles, people names)
                       to help Haiku preserve correct names during extraction.

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
        extraction, usage = extract_from_chunk(client, chunk, i, len(chunks), context_brief)
        extracted_sections.append(f"### Segment {i} of {len(chunks)}\n{extraction}")
        total_usage["input_tokens"] += usage["input_tokens"]
        total_usage["output_tokens"] += usage["output_tokens"]

    combined = "\n\n".join(extracted_sections)
    total_cost = (total_usage["input_tokens"] * 3.0 + total_usage["output_tokens"] * 15.0) / 1_000_000
    logger.info(f"Extraction complete — {len(chunks)} chunks — total Sonnet extraction cost: ${total_cost:.4f}")

    return {
        "extracted_content": combined,
        "num_chunks": len(chunks),
        "extraction_usage": total_usage,
        "extraction_cost": total_cost,
    }
