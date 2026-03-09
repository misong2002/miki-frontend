def infer_emotion(user_text: str, assistant_text: str) -> dict:
    text = f"{user_text}\n{assistant_text}"

    lowered = text.lower()

    if any(k in lowered for k in ["error", "报错", "失败", "不对", "wrong"]):
        return {"primary": "concerned", "intensity": 0.8}

    if any(k in lowered for k in ["解释", "推导", "为什么", "how", "why"]):
        return {"primary": "thinking", "intensity": 0.7}

    if any(k in lowered for k in ["好", "不错", "可以", "太好了", "great"]):
        return {"primary": "happy", "intensity": 0.6}

    return {"primary": "neutral", "intensity": 0.5}