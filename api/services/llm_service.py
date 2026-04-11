# api/services/llm_service.py

from __future__ import annotations

import os
from typing import Any

from openai import OpenAI

from config import OPENAI_MODEL
from services.persona_service import get_system_prompt

_DEFAULT_BASE_URL = "https://api.jiekou.ai/openai"
_client: OpenAI | None = None


def get_llm_base_url() -> str:
    return os.getenv("OPENAI_BASE_URL") or os.getenv("LLM_BASE_URL") or _DEFAULT_BASE_URL


def get_llm_client() -> OpenAI:
    global _client

    if _client is None:
        _client = OpenAI(
            api_key=os.getenv("LLM_API_KEY"),
            base_url=get_llm_base_url(),
        )

    return _client


def _build_chat_messages(history, user_message: str, system_prompt: str):
    messages = [
        {"role": "system", "content": system_prompt}
    ]

    for msg in history or []:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if not content:
            continue

        messages.append({
            "role": role,
            "content": content,
        })

    messages.append({
        "role": "user",
        "content": user_message,
    })

    return messages


def chat_with_miki(history, user_message: str):
    system_prompt = get_system_prompt()

    messages = _build_chat_messages(
        history=history,
        user_message=user_message,
        system_prompt=system_prompt,
    )

    response = get_llm_client().chat.completions.create(
        model=OPENAI_MODEL,
        messages=messages,
        temperature=0.7,
        max_tokens=50000,
    )

    text = response.choices[0].message.content or ""

    print("LLM TEXT:", text)

    return text


def generate_json_completion(
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.1,
    max_output_tokens: int | None = None,
) -> str:
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    kwargs: dict[str, Any] = {
        "model": OPENAI_MODEL,
        "messages": messages,
        "temperature": temperature,
        "stream": False,
    }

    if max_output_tokens is not None:
        kwargs["max_tokens"] = max_output_tokens

    response = get_llm_client().chat.completions.create(**kwargs)

    text = response.choices[0].message.content or ""

    print("LLM JSON TASK TEXT:", text)

    return text
