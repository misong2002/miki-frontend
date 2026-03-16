# Api/services/llm_service.py

import os
from openai import OpenAI

from config import OPENAI_MODEL
from services.persona_service import get_system_prompt


client = OpenAI(
    api_key=os.getenv("LLM_API_KEY"),
    base_url="https://api.jiekou.ai/openai",
)


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

    response = client.chat.completions.create(
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
    """
    给结构化任务（如长期记忆提炼）使用的非流式 completion。

    参数：
    - system_prompt: 任务级 system prompt
    - user_prompt: 输入内容
    - temperature: 默认较低，保证结构更稳定
    - max_output_tokens:
        None 时不显式传 max_tokens，交给模型侧默认行为。
        传整数时则写入 max_tokens。
    """

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    kwargs = {
        "model": OPENAI_MODEL,
        "messages": messages,
        "temperature": temperature,
        "stream": False,
    }

    if max_output_tokens is not None:
        kwargs["max_tokens"] = max_output_tokens

    response = client.chat.completions.create(**kwargs)

    text = response.choices[0].message.content or ""

    print("LLM JSON TASK TEXT:", text)

    return text