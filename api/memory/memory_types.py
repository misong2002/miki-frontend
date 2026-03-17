# backend/memory/memory_types.py

from __future__ import annotations

import time
import uuid
from typing import Any, Dict, List, Optional


def now_ms() -> int:
    return int(time.time() * 1000)


def make_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def create_empty_long_term_db() -> Dict[str, Any]:
    ts = now_ms()
    return {
        "meta": {
            "version": 1,
            "created_at": ts,
            "updated_at": ts,
            "last_archive_at": None,
            "last_digest_rebuild_at": None,
        },
        "session_summaries": [],
        "user_facts": [],
        "idea_memories": [],
        "project_states": [],
        "memory_digests": [],
    }


def make_session_summary(
    wake_cycle_ids: List[str],
    start_at: int,
    end_at: int,
    summary: str,
    topics: Optional[List[str]] = None,
    open_loops: Optional[List[str]] = None,
    resolved_items: Optional[List[str]] = None,
    source_message_count: int = 0,
) -> Dict[str, Any]:
    ts = now_ms()
    return {
        "id": make_id("summary"),
        "wake_cycle_ids": wake_cycle_ids,
        "start_at": start_at,
        "end_at": end_at,
        "summary": summary,
        "topics": topics or [],
        "open_loops": open_loops or [],
        "resolved_items": resolved_items or [],
        "source_message_count": source_message_count,
        "created_at": ts,
        "updated_at": ts,
    }


def make_user_fact(
    key: str,
    value: str,
    category: str,
    confidence: float = 0.8,
    pinned: bool = False,
    source_summary_ids: Optional[List[str]] = None,
    source_wake_cycle_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    ts = now_ms()
    return {
        "id": make_id("fact"),
        "key": key,
        "value": value,
        "category": category,
        "confidence": confidence,
        "pinned": pinned,
        "source_summary_ids": source_summary_ids or [],
        "source_wake_cycle_ids": source_wake_cycle_ids or [],
        "created_at": ts,
        "updated_at": ts,
    }


def make_idea_memory(
    title: str,
    content: str,
    category: str,
    status: str = "open",
    novelty: float = 0.8,
    importance: float = 0.8,
    tags: Optional[List[str]] = None,
    open_questions: Optional[List[str]] = None,
    related_fact_ids: Optional[List[str]] = None,
    source_summary_ids: Optional[List[str]] = None,
    source_wake_cycle_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    ts = now_ms()
    return {
        "id": make_id("idea"),
        "title": title,
        "content": content,
        "category": category,
        "status": status,
        "novelty": novelty,
        "importance": importance,
        "tags": tags or [],
        "open_questions": open_questions or [],
        "related_fact_ids": related_fact_ids or [],
        "source_summary_ids": source_summary_ids or [],
        "source_wake_cycle_ids": source_wake_cycle_ids or [],
        "created_at": ts,
        "updated_at": ts,
    }


def make_project_state(
    project_key: str,
    title: str,
    status: str,
    summary: str,
    recent_changes: Optional[List[str]] = None,
    next_steps: Optional[List[str]] = None,
    related_summary_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    ts = now_ms()
    return {
        "id": make_id("project"),
        "project_key": project_key,
        "title": title,
        "status": status,
        "summary": summary,
        "recent_changes": recent_changes or [],
        "next_steps": next_steps or [],
        "related_summary_ids": related_summary_ids or [],
        "created_at": ts,
        "updated_at": ts,
    }


def make_memory_digest(
    digest_type: str,
    content: str,
    source_fact_ids: Optional[List[str]] = None,
    source_project_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    ts = now_ms()
    return {
        "id": make_id("digest"),
        "type": digest_type,
        "content": content,
        "source_fact_ids": source_fact_ids or [],
        "source_project_ids": source_project_ids or [],
        "created_at": ts,
        "updated_at": ts,
    }