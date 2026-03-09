from pathlib import Path

PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "sayaka_system.txt"

def get_system_prompt() -> str:
    return PROMPT_PATH.read_text(encoding="utf-8")