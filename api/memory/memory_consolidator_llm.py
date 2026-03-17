# api/memory/memory_consolidator_llm.py

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from services.llm_service import generate_json_completion


MEMORY_CONSOLIDATOR_SYSTEM_PROMPT = """
You are a memory consolidator for an AI assistant.

Your job is to extract structured long-term memory from a dialogue.

You must return valid JSON only.

Your output must contain exactly these top-level fields:
- summary
- facts
- ideas
- project_updates

Extraction principles:

1. facts:
- Only include durable user information worth remembering long-term.
- Prefer research interests, long-term goals, stable preferences, important background, major past events, and recurring traits.
- Do NOT include trivial short-term details.

2. ideas:
- Extract important user-generated ideas, hypotheses, research directions, conceptual proposals, or technically meaningful thoughts.
- Especially preserve ideas in physics, mathematics, machine learning, philosophy, or system design.
- Include feasibility questions or open difficulties when present.

3. project_updates:
- Extract updates to ongoing long-term projects only if the dialogue clearly indicates progress, current status, or next steps.

4. summary:
- Summarize the dialogue segment itself.
- Keep it concise but informative.

5. language:
- Keep all returned text fields in Chinese unless the source content is clearly better preserved in English technical terms.

Output constraints:
- Return JSON only.
- Do not wrap in markdown fences.
- Do not include commentary outside JSON.
- If a category has nothing important, return an empty list.
"""


def _clean_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    cleaned = []
    for msg in messages or []:
        content = (msg.get("content") or "").strip()
        if not content:
            continue

        created_at = msg.get("createdAt") or msg.get("created_at")
        wake_cycle_id = msg.get("wakeCycleId") or msg.get("wake_cycle_id")

        cleaned.append(
            {
                "id": msg.get("id"),
                "role": msg.get("role", "unknown"),
                "content": content,
                "created_at": created_at,
                "wake_cycle_id": wake_cycle_id,
            }
        )

    return cleaned


def _truncate_text(text: str, max_chars: int = 4000) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n...[truncated]"


def _prepare_messages_for_prompt(
    messages: List[Dict[str, Any]],
    max_messages: int = 120,
    max_chars_per_message: int = 4000,
) -> List[Dict[str, Any]]:
    cleaned = _clean_messages(messages)
    cleaned = cleaned[-max_messages:]

    prepared = []
    for msg in cleaned:
        prepared.append(
            {
                **msg,
                "content": _truncate_text(msg["content"], max_chars=max_chars_per_message),
            }
        )
    return prepared


def _format_json_input(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2)


def build_memory_consolidation_prompt(
    messages: List[Dict[str, Any]],
    observations: Optional[List[Dict[str, Any]]] = None,
    training_runs: Optional[List[Dict[str, Any]]] = None,
) -> str:
    prepared_messages = _prepare_messages_for_prompt(messages)

    payload = {
        "messages": prepared_messages,
        "observations": observations or [],
        "training_runs": training_runs or [],
        "required_output_schema": {
            "summary": {
                "summary": "string",
                "topics": ["string"],
                "open_loops": ["string"],
                "resolved_items": ["string"],
            },
            "facts": [
                {
                    "key": "string",
                    "value": "string",
                    "category": "identity | background | major_life_event | research_interest | research_style | preference | long_term_goal | project_context",
                    "confidence": 0.0,
                    "pinned": False,
                }
            ],
            "ideas": [
                {
                    "title": "string",
                    "content": "string",
                    "category": "string",
                    "status": "open | active | resolved | abandoned",
                    "novelty": 0.0,
                    "importance": 0.0,
                    "tags": ["string"],
                    "open_questions": ["string"],
                }
            ],
            "project_updates": [
                {
                    "project_key": "string",
                    "title": "string",
                    "status": "active | paused | completed | abandoned",
                    "summary": "string",
                    "recent_changes": ["string"],
                    "next_steps": ["string"],
                }
            ],
        },
    }

    instructions = """
Please consolidate the following interaction into structured long-term memory.

Priorities:
1. Extract durable user facts worth remembering.
2. Extract important user-generated ideas, especially in physics, mathematics, machine learning, philosophy, or system design.
3. Extract ongoing long-term project updates only when clearly justified.
4. Summarize the dialogue segment itself.

Important:
- Preserve scientifically meaningful ideas even if they are speculative.
- If the user discusses an idea in depth, do not reduce it to a vague sentence.
- If the user reveals significant past experiences or life events, record them as durable facts only when they appear genuinely important and non-trivial.
- Do not invent facts.
- Do not include generic filler.
- Return strict JSON only.
"""

    return instructions.strip() + "\n\nINPUT:\n" + _format_json_input(payload)


def _extract_json_text(text: str) -> str:
    stripped = text.strip()

    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        stripped = "\n".join(lines).strip()

    start = stripped.find("{")
    end = stripped.rfind("}")

    if start == -1 or end == -1 or end < start:
        raise ValueError("no valid JSON object found in LLM output")

    return stripped[start : end + 1]


def _ensure_list_of_strings(value: Any) -> List[str]:
    if not isinstance(value, list):
        return []
    result = []
    for item in value:
        if item is None:
            continue
        text = str(item).strip()
        if text:
            result.append(text)
    return result


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        f = float(value)
        if f < 0.0:
            return 0.0
        if f > 1.0:
            return 1.0
        return f
    except Exception:
        return default


def _normalize_summary_block(data: Any) -> Dict[str, Any]:
    if not isinstance(data, dict):
        data = {}

    return {
        "summary": str(data.get("summary", "") or "").strip(),
        "topics": _ensure_list_of_strings(data.get("topics")),
        "open_loops": _ensure_list_of_strings(data.get("open_loops")),
        "resolved_items": _ensure_list_of_strings(data.get("resolved_items")),
    }


def _normalize_facts(data: Any) -> List[Dict[str, Any]]:
    if not isinstance(data, list):
        return []

    result = []
    for item in data:
        if not isinstance(item, dict):
            continue

        key = str(item.get("key", "") or "").strip()
        value = str(item.get("value", "") or "").strip()
        category = str(item.get("category", "") or "").strip()

        if not key or not value or not category:
            continue

        result.append(
            {
                "key": key,
                "value": value,
                "category": category,
                "confidence": _to_float(item.get("confidence"), 0.8),
                "pinned": bool(item.get("pinned", False)),
            }
        )

    return result


def _normalize_ideas(data: Any) -> List[Dict[str, Any]]:
    if not isinstance(data, list):
        return []

    result = []
    for item in data:
        if not isinstance(item, dict):
            continue

        title = str(item.get("title", "") or "").strip()
        content = str(item.get("content", "") or "").strip()
        category = str(item.get("category", "") or "").strip()

        if not title or not content or not category:
            continue

        result.append(
            {
                "title": title,
                "content": content,
                "category": category,
                "status": str(item.get("status", "open") or "open").strip(),
                "novelty": _to_float(item.get("novelty"), 0.8),
                "importance": _to_float(item.get("importance"), 0.8),
                "tags": _ensure_list_of_strings(item.get("tags")),
                "open_questions": _ensure_list_of_strings(item.get("open_questions")),
            }
        )

    return result


def _normalize_project_updates(data: Any) -> List[Dict[str, Any]]:
    if not isinstance(data, list):
        return []

    result = []
    for item in data:
        if not isinstance(item, dict):
            continue

        project_key = str(item.get("project_key", "") or "").strip()
        title = str(item.get("title", "") or "").strip()
        status = str(item.get("status", "") or "").strip()
        summary = str(item.get("summary", "") or "").strip()

        if not project_key or not title or not status:
            continue

        result.append(
            {
                "project_key": project_key,
                "title": title,
                "status": status,
                "summary": summary,
                "recent_changes": _ensure_list_of_strings(item.get("recent_changes")),
                "next_steps": _ensure_list_of_strings(item.get("next_steps")),
            }
        )

    return result


def _normalize_consolidation_result(data: Any) -> Dict[str, Any]:
    if not isinstance(data, dict):
        raise ValueError("LLM output is not a JSON object")

    return {
        "summary": _normalize_summary_block(data.get("summary")),
        "facts": _normalize_facts(data.get("facts")),
        "ideas": _normalize_ideas(data.get("ideas")),
        "project_updates": _normalize_project_updates(data.get("project_updates")),
    }


def consolidate_memory_with_llm(
    messages: List[Dict[str, Any]],
    observations: Optional[List[Dict[str, Any]]] = None,
    training_runs: Optional[List[Dict[str, Any]]] = None,
    max_output_tokens: Optional[int] = None,
) -> Dict[str, Any]:
    prepared_messages = _prepare_messages_for_prompt(messages)
    if not prepared_messages:
        return {
            "summary": {
                "summary": "",
                "topics": [],
                "open_loops": [],
                "resolved_items": [],
            },
            "facts": [],
            "ideas": [],
            "project_updates": [],
        }

    user_prompt = build_memory_consolidation_prompt(
        messages=prepared_messages,
        observations=observations,
        training_runs=training_runs,
    )

    raw_text = generate_json_completion(
        system_prompt=MEMORY_CONSOLIDATOR_SYSTEM_PROMPT,
        user_prompt=user_prompt,
        temperature=0.1,
        max_output_tokens=max_output_tokens,
    )

    json_text = _extract_json_text(raw_text)
    parsed = json.loads(json_text)
    return _normalize_consolidation_result(parsed)