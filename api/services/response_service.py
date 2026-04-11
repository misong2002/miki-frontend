from __future__ import annotations

from typing import Any


def success_payload(*, message: str | None = None, status: str | None = None, **data: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "ok": True,
        **data,
    }

    if message is not None and "message" not in payload:
        payload["message"] = message

    if status is not None and "status" not in payload:
        payload["status"] = status

    return payload


def error_payload(
    error: str,
    *,
    message: str | None = None,
    status: str = "error",
    **data: Any,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "ok": False,
        "status": status,
        "error": error,
        "message": message or error,
        **data,
    }

    return payload
