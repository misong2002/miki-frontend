from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any, Sequence

MAX_COMMAND_OUTPUT_CHARS = 4000


def run_command(
    command: Sequence[str],
    *,
    cwd: str | Path | None = None,
    check: bool = False,
    text: bool = True,
):
    return subprocess.run(
        list(command),
        cwd=str(cwd) if cwd is not None else None,
        capture_output=True,
        text=text,
        check=check,
    )


def summarize_command_output(output: str | None, *, limit: int = MAX_COMMAND_OUTPUT_CHARS) -> str:
    text = str(output or '').strip()
    if not text:
        return ''
    if len(text) <= limit:
        return text
    return f"...{text[-limit:]}"


def command_result_payload(completed: Any) -> dict[str, Any]:
    return {
        'returncode': getattr(completed, 'returncode', None),
        'stdout_preview': summarize_command_output(getattr(completed, 'stdout', '')),
        'stderr_preview': summarize_command_output(getattr(completed, 'stderr', '')),
    }
