from collections import defaultdict

_sessions = defaultdict(list)

def append_message(session_id: str, role: str, content: str):
    _sessions[session_id].append({
        "role": role,
        "content": content,
    })

def get_recent_messages(session_id: str, limit: int = 12):
    return _sessions[session_id][-limit:]

def clear_session(session_id: str):
    _sessions.pop(session_id, None)