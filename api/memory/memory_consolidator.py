# api/memory/memory_consolidator.py

from __future__ import annotations

from typing import Any, Dict, List, Optional

from .memory_consolidator_llm import consolidate_memory_with_llm
from .memory_consolidator_rules import consolidate_memory_with_rules


def consolidate_memory(
    messages: List[Dict[str, Any]],
    observations: Optional[List[Dict[str, Any]]] = None,
    training_runs: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    try:
        return consolidate_memory_with_llm(
            messages=messages,
            observations=observations,
            training_runs=training_runs,
            max_output_tokens=None,
        )
    except Exception as e:
        print("[memory consolidator] llm failed, fallback to rules:", e, flush=True)
        return consolidate_memory_with_rules(
            messages=messages,
            observations=observations,
            training_runs=training_runs,
        )