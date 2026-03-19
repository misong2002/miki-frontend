import json
from typing import Any, Generator

from config import OPENAI_MODEL
from services.llm_service import client
from services.memory_service import get_recent_messages, append_message
from services.persona_service import get_system_prompt


def build_chat_messages(session_id: str, user_message: str) -> list[dict[str, str]]:
    history = get_recent_messages(session_id, limit=12)

    messages = [
        {"role": "system", "content": get_system_prompt()}
    ]

    for msg in history:
        messages.append({
            "role": msg["role"],
            "content": msg["content"],
        })

    messages.append({
        "role": "user",
        "content": user_message,
    })

    return messages


def create_chat_stream_response(
    data: dict[str, Any],
) -> Generator[str, None, None] | tuple[dict[str, Any], int]:
    session_id = data.get("session_id", "default-session")
    user_message = data.get("message", "").strip()

    if not user_message:
        return {"error": "empty message"}, 400

    messages = build_chat_messages(session_id, user_message)

    try:
        stream = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=messages,
            temperature=0.7,
            max_tokens=8000,
            stream=True,
        )
    except Exception as e:
        print("LLM stream init error:", e, flush=True)
        return {"error": f"LLM stream init failed: {e}"}, 500

    def generate() -> Generator[str, None, None]:
        full_reply = ""

        try:
            for chunk in stream:
                if not chunk.choices:
                    continue

                delta = chunk.choices[0].delta
                token = getattr(delta, "content", None)

                if token is None:
                    continue

                full_reply += token
                yield json.dumps({"token": token}, ensure_ascii=False) + "\n"

            append_message(session_id, "user", user_message)
            append_message(session_id, "assistant", full_reply)

        except Exception as e:
            print("LLM stream runtime error:", e, flush=True)
            yield json.dumps(
                {"error": f"stream runtime failed: {str(e)}"},
                ensure_ascii=False,
            ) + "\n"

    return generate()