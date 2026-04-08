SINGLE_CHAT_SESSION_ID = "single-user-session"
_session_messages: list[dict[str, str]] = []


def get_single_chat_session_id() -> str:
    return SINGLE_CHAT_SESSION_ID


def append_message(role: str, content: str):
    _session_messages.append({
        "role": role,
        "content": content,
    })


def get_recent_messages(limit: int = 12):
    return _session_messages[-limit:]


def clear_session():
    _session_messages.clear()
