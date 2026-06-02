from pathlib import Path

PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "sayaka_system.txt"


def _load_system_prompt_memory_digest() -> str:
    try:
        from memory.memory_runtime import SYSTEM_PROMPT_DIGEST_TYPE
        from memory.memory_store import get_memory_digest_by_type

        digest = get_memory_digest_by_type(SYSTEM_PROMPT_DIGEST_TYPE)
    except Exception as exc:
        print("[persona] failed to load system prompt memory digest:", exc, flush=True)
        return ""

    content = str(digest.get("content") or "").strip() if isinstance(digest, dict) else ""
    if not content:
        return ""

    return (
        "【长期核心记忆】\n"
        "以下是关于用户的长期核心记忆，用于保持连续性。只在相关时自然使用，不要生硬复述。\n"
        f"{content}"
    )


def get_system_prompt() -> str:
    base_prompt = PROMPT_PATH.read_text(encoding="utf-8").strip()
    memory_digest = _load_system_prompt_memory_digest()
    if not memory_digest:
        return base_prompt
    return f"{base_prompt}\n\n{memory_digest}"
