from __future__ import annotations

from threading import RLock
from typing import Any

SINGLE_CHAT_SESSION_ID = "single-user-session"
_session_messages_by_id: dict[str, list[dict[str, str]]] = {
    SINGLE_CHAT_SESSION_ID: [],
}
_session_lock = RLock()


def _normalize_session_id(session_id: str | None = None) -> str:
    value = str(session_id or "").strip()
    return value or SINGLE_CHAT_SESSION_ID


def get_single_chat_session_id() -> str:
    return SINGLE_CHAT_SESSION_ID


def append_message(
    role: str,
    content: str,
    session_id: str | None = None,
    message_type: str | None = None,
):
    resolved_session_id = _normalize_session_id(session_id)

    with _session_lock:
        bucket = _session_messages_by_id.setdefault(resolved_session_id, [])
        bucket.append({
            "role": role,
            "content": content,
            "type": message_type or role,
        })


def get_recent_messages(limit: int = 12, session_id: str | None = None):
    resolved_session_id = _normalize_session_id(session_id)

    with _session_lock:
        messages = list(_session_messages_by_id.get(resolved_session_id, []))

    return messages[-limit:]


def clear_session(session_id: str | None = None):
    resolved_session_id = _normalize_session_id(session_id)

    with _session_lock:
        _session_messages_by_id[resolved_session_id] = []


def archive_wake_cycle_payload(payload: dict[str, Any]) -> dict[str, Any]:
    from memory.memory_runtime import archive_wake_cycle

    return archive_wake_cycle(payload)


def get_long_term_memory_overview_payload() -> dict[str, Any]:
    from memory.memory_runtime import get_long_term_memory_overview

    return get_long_term_memory_overview()


def get_system_prompt_memory_payload() -> dict[str, Any]:
    from memory.memory_runtime import get_system_prompt_memory

    return get_system_prompt_memory()


def get_recent_memory_snapshot_payload(
    *,
    summary_limit: int = 10,
    idea_limit: int = 10,
) -> dict[str, Any]:
    from memory.memory_runtime import get_recent_memory_snapshot

    return get_recent_memory_snapshot(
        summary_limit=summary_limit,
        idea_limit=idea_limit,
    )


def rebuild_system_prompt_digest_payload() -> dict[str, Any]:
    from memory.memory_runtime import rebuild_system_prompt_digest

    digest = rebuild_system_prompt_digest()
    return {
        "ok": True,
        "digest": digest,
    }


def retrieve_long_term_memory_payload(query: str, *, limit: int = 6) -> dict[str, Any]:
    from services.chat_service import get_long_term_memory_retrieval_payload

    return get_long_term_memory_retrieval_payload(query, limit=limit)


def create_memory_backup_payload() -> dict[str, Any]:
    from memory.memory_runtime import create_backup

    return create_backup()


def get_memory_storage_manifest() -> dict[str, Any]:
    from memory.memory_store import get_storage_manifest

    return {
        "ok": True,
        "storage": get_storage_manifest(),
    }
