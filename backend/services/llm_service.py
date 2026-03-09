import os
from openai import OpenAI
from services.persona_service import get_system_prompt

client = OpenAI(
    api_key=os.getenv("LLM_API_KEY"),
    base_url="https://api.jiekou.ai/openai",
)

def chat_with_miki(history, user_message: str):

    system_prompt = get_system_prompt()

    messages = [
        {"role": "system", "content": system_prompt}
    ]

    for msg in history:
        messages.append({
            "role": msg["role"],
            "content": msg["content"]
        })

    messages.append({
        "role": "user",
        "content": user_message
    })

    response = client.chat.completions.create(
        model="gpt-5.4",
        messages=messages,
        temperature=0.7,
        max_tokens=50000
    )

    text = response.choices[0].message.content

    print("LLM TEXT:", text)

    return text