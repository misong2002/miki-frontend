# api/memory/memory_runtime.py

from __future__ import annotations

from typing import Any, Dict, List, Optional

from .memory_consolidator import consolidate_memory
from .memory_store import (
    backup_long_term_db,
    create_session_summary,
    get_long_term_db,
    get_memory_digest_by_type,
    list_idea_memories,
    list_memory_digests,
    list_project_states,
    list_session_summaries,
    list_user_facts,
    upsert_idea_memory,
    upsert_memory_digest,
    upsert_project_state,
    upsert_user_fact,
)
from .memory_types import (
    make_idea_memory,
    make_memory_digest,
    make_project_state,
    make_session_summary,
    make_user_fact,
)


SYSTEM_PROMPT_DIGEST_TYPE = "system_prompt_core"


def _extract_time_bounds(messages: List[Dict[str, Any]]) -> tuple[int, int]:
    times = []
    for msg in messages or []:
        ts = msg.get("createdAt") or msg.get("created_at")
        if isinstance(ts, (int, float)):
            times.append(int(ts))

    if not times:
        return 0, 0

    return min(times), max(times)


def _extract_wake_cycle_ids(
    payload_wake_cycle_id: Optional[str],
    messages: List[Dict[str, Any]],
) -> List[str]:
    ids = []

    if payload_wake_cycle_id:
        ids.append(payload_wake_cycle_id)

    for msg in messages or []:
        wake_cycle_id = msg.get("wakeCycleId") or msg.get("wake_cycle_id")
        if wake_cycle_id and wake_cycle_id not in ids:
            ids.append(wake_cycle_id)

    return ids


def rebuild_system_prompt_digest() -> Dict[str, Any]:
    facts = list_user_facts()
    projects = list_project_states(status="active")

    pinned_or_high_conf_facts = [
        fact
        for fact in facts
        if fact.get("pinned") or float(fact.get("confidence", 0.0)) >= 0.85
    ]

    fact_lines = [
        f"- {fact.get('value', '').strip()}"
        for fact in pinned_or_high_conf_facts[:8]
        if fact.get("value", "").strip()
    ]

    project_lines = []
    for project in projects[:5]:
        title = (project.get("title") or "").strip()
        summary = (project.get("summary") or "").strip()
        if title and summary:
            project_lines.append(f"- {title}: {summary}")
        elif title:
            project_lines.append(f"- {title}")

    content_parts = []

    if fact_lines:
        content_parts.append("【用户长期事实】")
        content_parts.extend(fact_lines)

    if project_lines:
        content_parts.append("【长期项目状态】")
        content_parts.extend(project_lines)

    digest_content = "\n".join(content_parts).strip()

    digest = make_memory_digest(
        digest_type=SYSTEM_PROMPT_DIGEST_TYPE,
        content=digest_content,
        source_fact_ids=[fact["id"] for fact in pinned_or_high_conf_facts[:8]],
        source_project_ids=[project["id"] for project in projects[:5]],
    )

    return upsert_memory_digest(digest)


def archive_wake_cycle(payload: Dict[str, Any]) -> Dict[str, Any]:
    wake_cycle_id = payload.get("wake_cycle_id")
    messages = payload.get("messages") or []
    observations = payload.get("observations") or []
    training_runs = payload.get("training_runs") or []
    force_rebuild_digest = bool(payload.get("force_rebuild_digest", True))

    if not isinstance(messages, list) or len(messages) == 0:
        raise ValueError("messages must be a non-empty list")

    wake_cycle_ids = _extract_wake_cycle_ids(wake_cycle_id, messages)
    start_at, end_at = _extract_time_bounds(messages)

    consolidated = consolidate_memory(
        messages=messages,
        observations=observations,
        training_runs=training_runs,
    )

    summary_block = consolidated.get("summary") or {}
    facts_block = consolidated.get("facts") or []
    ideas_block = consolidated.get("ideas") or []
    project_updates_block = consolidated.get("project_updates") or []

    summary_obj = make_session_summary(
        wake_cycle_ids=wake_cycle_ids,
        start_at=start_at,
        end_at=end_at,
        summary=summary_block.get("summary", ""),
        topics=summary_block.get("topics", []),
        open_loops=summary_block.get("open_loops", []),
        resolved_items=summary_block.get("resolved_items", []),
        source_message_count=len(messages),
    )
    summary_obj = create_session_summary(summary_obj)

    created_or_updated_facts = []
    for fact in facts_block:
        fact_obj = make_user_fact(
            key=fact["key"],
            value=fact["value"],
            category=fact["category"],
            confidence=float(fact.get("confidence", 0.8)),
            pinned=bool(fact.get("pinned", False)),
            source_summary_ids=[summary_obj["id"]],
            source_wake_cycle_ids=wake_cycle_ids,
        )
        created_or_updated_facts.append(upsert_user_fact(fact_obj))

    created_or_updated_ideas = []
    for idea in ideas_block:
        idea_obj = make_idea_memory(
            title=idea["title"],
            content=idea["content"],
            category=idea["category"],
            status=idea.get("status", "open"),
            novelty=float(idea.get("novelty", 0.8)),
            importance=float(idea.get("importance", 0.8)),
            tags=idea.get("tags", []),
            open_questions=idea.get("open_questions", []),
            related_fact_ids=[],
            source_summary_ids=[summary_obj["id"]],
            source_wake_cycle_ids=wake_cycle_ids,
        )
        created_or_updated_ideas.append(upsert_idea_memory(idea_obj))

    created_or_updated_projects = []
    for project in project_updates_block:
        project_obj = make_project_state(
            project_key=project["project_key"],
            title=project["title"],
            status=project["status"],
            summary=project["summary"],
            recent_changes=project.get("recent_changes", []),
            next_steps=project.get("next_steps", []),
            related_summary_ids=[summary_obj["id"]],
        )
        created_or_updated_projects.append(upsert_project_state(project_obj))

    digest = None
    if force_rebuild_digest:
      digest = rebuild_system_prompt_digest()

    return {
        "ok": True,
        "summary_id": summary_obj["id"],
        "summary": summary_obj,
        "fact_ids": [item["id"] for item in created_or_updated_facts],
        "idea_ids": [item["id"] for item in created_or_updated_ideas],
        "project_ids": [item["id"] for item in created_or_updated_projects],
        "digest_id": digest["id"] if digest else None,
        "updated_fact_keys": [item["key"] for item in created_or_updated_facts],
        "updated_project_keys": [
            item["project_key"] for item in created_or_updated_projects
        ],
    }


def get_long_term_memory_overview() -> Dict[str, Any]:
    db = get_long_term_db()
    return {
        "ok": True,
        "data": db,
    }


def get_system_prompt_memory() -> Dict[str, Any]:
    digest = get_memory_digest_by_type(SYSTEM_PROMPT_DIGEST_TYPE)
    facts = list_user_facts()
    projects = list_project_states(status="active")

    return {
        "ok": True,
        "digest": digest,
        "facts": facts,
        "projects": projects,
    }


def get_recent_memory_snapshot(
    summary_limit: int = 10,
    idea_limit: int = 10,
) -> Dict[str, Any]:
    return {
        "ok": True,
        "session_summaries": list_session_summaries(limit=summary_limit),
        "user_facts": list_user_facts(),
        "idea_memories": list_idea_memories()[:idea_limit],
        "project_states": list_project_states(),
        "memory_digests": list_memory_digests(),
    }


def create_backup() -> Dict[str, Any]:
    path = backup_long_term_db()
    return {
        "ok": True,
        "backup_path": path,
    }