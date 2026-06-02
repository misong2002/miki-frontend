from __future__ import annotations

import fnmatch
import json
import os
from pathlib import Path
from typing import Any

from config import MIKI_ROOT
from services.response_service import error_payload, success_payload


WORKSPACE_ROOT = Path(os.getenv("MIKI_CODE_AGENT_ROOT", str(MIKI_ROOT))).resolve()
MAX_LIST_ITEMS = int(os.getenv("MIKI_CODE_AGENT_MAX_LIST_ITEMS", "1000"))
MAX_SEARCH_RESULTS = int(os.getenv("MIKI_CODE_AGENT_MAX_SEARCH_RESULTS", "160"))
MAX_READ_BYTES = int(os.getenv("MIKI_CODE_AGENT_MAX_READ_BYTES", str(440 * 1024)))
MAX_NOTEBOOK_BYTES = int(os.getenv("MIKI_CODE_AGENT_MAX_NOTEBOOK_BYTES", str(20 * 1024 * 1024)))
MAX_NOTEBOOK_OUTPUT_CHARS = int(os.getenv("MIKI_CODE_AGENT_MAX_NOTEBOOK_OUTPUT_CHARS", "12000"))
MAX_PATH_MATCH_CANDIDATES = int(os.getenv("MIKI_CODE_AGENT_MAX_PATH_MATCH_CANDIDATES", "40"))
SKIP_DIRS = {
    ".git",
    ".cache",
    ".vite",
    "__pycache__",
    "node_modules",
    "dist",
    "build",
    "history",
    "data",
    "log",
    ".pytest_cache",
}
SKIP_FILE_PATTERNS = {
    "*.pyc",
    "*.pyo",
    "*.png",
    "*.jpg",
    "*.jpeg",
    "*.gif",
    "*.webp",
    "*.woff",
    "*.woff2",
    "*.ttf",
    "*.mp4",
    "*.zip",
    "*.tar",
    "*.gz",
}


def _normalize_rel_path(value: Any) -> str:
    raw = str(value or "").strip().replace("\\", "/")
    return raw.lstrip("/")


def _resolve_workspace_path(rel_path: str = "") -> Path:
    target = (WORKSPACE_ROOT / _normalize_rel_path(rel_path)).resolve()
    try:
        target.relative_to(WORKSPACE_ROOT)
    except ValueError as exc:
        raise ValueError("path escapes workspace root") from exc
    return target


def _rel(path: Path) -> str:
    return path.resolve().relative_to(WORKSPACE_ROOT).as_posix()


def _should_skip_path(path: Path) -> bool:
    parts = set(path.parts)
    if parts.intersection(SKIP_DIRS):
        return True
    name = path.name
    return any(fnmatch.fnmatch(name, pattern) for pattern in SKIP_FILE_PATTERNS)


def _is_text_file(path: Path) -> bool:
    if _should_skip_path(path):
        return False

    try:
        chunk = path.read_bytes()[:2048]
    except Exception:
        return False

    if b"\x00" in chunk:
        return False
    return True


def _read_notebook_text(path: Path) -> str:
    notebook = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    cells = notebook.get("cells") if isinstance(notebook, dict) else None
    if not isinstance(cells, list):
        raise ValueError("notebook cells are missing")

    chunks: list[str] = []
    for index, cell in enumerate(cells, start=1):
        if not isinstance(cell, dict):
            continue
        cell_type = str(cell.get("cell_type") or "cell").strip() or "cell"
        text = _stringify_notebook_text(cell.get("source"))
        text = text.strip("\n")
        cell_chunks = []
        if text:
            cell_chunks.append(f"# %% [{cell_type}] cell {index}\n{text}")
        cell_chunks.extend(_notebook_text_outputs(cell))
        if cell_chunks:
            chunks.append("\n\n".join(cell_chunks))

    return "\n\n".join(chunks)


def _stringify_notebook_text(value: Any) -> str:
    if isinstance(value, list):
        return "".join(str(part) for part in value)
    return str(value or "")


def _clip_notebook_output(text: str) -> str:
    if len(text) <= MAX_NOTEBOOK_OUTPUT_CHARS:
        return text
    return f"{text[:MAX_NOTEBOOK_OUTPUT_CHARS]}\n...<output truncated>"


def _notebook_text_outputs(cell: dict[str, Any]) -> list[str]:
    outputs = cell.get("outputs")
    if not isinstance(outputs, list):
        return []

    texts: list[str] = []
    for output in outputs:
        if not isinstance(output, dict):
            continue

        output_type = str(output.get("output_type") or "output").strip() or "output"
        text = ""
        if output_type == "stream":
            text = _stringify_notebook_text(output.get("text"))
        else:
            data = output.get("data")
            if isinstance(data, dict):
                text = _stringify_notebook_text(data.get("text/plain"))

        text = text.strip("\n")
        if text:
            texts.append(f"# %% [output:{output_type}]\n{_clip_notebook_output(text)}")

    return texts


def _read_agent_text(path: Path) -> str:
    if path.suffix.lower() == ".ipynb":
        return _read_notebook_text(path)
    return path.read_text(encoding="utf-8", errors="replace")


def _iter_readable_files(root: Path, pattern: str = "*"):
    for path in root.rglob(pattern):
        if not path.is_file() or not _is_text_file(path):
            continue
        yield path


def _path_query_tokens(query: str) -> list[str]:
    raw = str(query or "").strip().replace("\\", "/").lower()
    if not raw:
        return []
    return [
        token
        for token in raw.replace("/", " ").replace("_", " ").replace("-", " ").split()
        if token
    ]


def _score_path_match(query: str, path: Path) -> float:
    rel = _rel(path).lower()
    name = path.name.lower()
    normalized_query = str(query or "").strip().replace("\\", "/").lower()
    tokens = _path_query_tokens(query)

    if not normalized_query:
        return 0.0

    score = 0.0
    if normalized_query == rel:
        score += 100.0
    if normalized_query == name:
        score += 80.0
    if normalized_query in rel:
        score += 50.0 + min(len(normalized_query), 40) / 10
    if normalized_query in name:
        score += 35.0

    for token in tokens:
        if len(token) < 2:
            continue
        if token in name:
            score += 12.0
        elif token in rel:
            score += 7.0

    if tokens and all(token in rel for token in tokens if len(token) >= 2):
        score += 20.0

    return score


def _find_fuzzy_path_matches(
    query: str,
    *,
    root: Path | None = None,
    pattern: str = "*",
    limit: int = MAX_PATH_MATCH_CANDIDATES,
) -> list[dict[str, Any]]:
    search_root = root or WORKSPACE_ROOT
    matches = []

    for path in _iter_readable_files(search_root, pattern):
        score = _score_path_match(query, path)
        if score <= 0:
            continue
        matches.append({
            "message": "这是模糊匹配得到的路径，请以 actual_path 为实际文件路径。",
            "query": query,
            "actual_path": _rel(path),
            "path": _rel(path),
            "name": path.name,
            "score": round(score, 2),
            "size": path.stat().st_size,
        })

    matches.sort(key=lambda item: (item["score"], -len(item["path"])), reverse=True)
    return matches[:limit]


def list_code_files_payload(payload: dict[str, Any]) -> tuple[dict[str, Any], int]:
    rel_path = _normalize_rel_path(payload.get("path"))
    pattern = str(payload.get("pattern") or "*").strip() or "*"
    recursive = bool(payload.get("recursive", True))
    max_items = min(int(payload.get("limit") or MAX_LIST_ITEMS), MAX_LIST_ITEMS)

    try:
        root = _resolve_workspace_path(rel_path)
    except ValueError as exc:
        return error_payload(str(exc)), 400

    if not root.exists():
        return error_payload("path not found"), 404
    if not root.is_dir():
        return error_payload("path must be a directory"), 400

    iterator = root.rglob(pattern) if recursive else root.glob(pattern)
    items = []

    for item in iterator:
        if len(items) >= max_items:
            break
        if _should_skip_path(item):
            continue

        items.append(
            {
                "path": _rel(item),
                "name": item.name,
                "type": "dir" if item.is_dir() else "file",
                "size": item.stat().st_size if item.is_file() else None,
            }
        )

    items.sort(key=lambda entry: (entry["type"] != "dir", entry["path"]))

    return success_payload(
        status="done",
        root=str(WORKSPACE_ROOT),
        path=rel_path,
        pattern=pattern,
        items=items,
        truncated=len(items) >= max_items,
    ), 200


def read_code_file_payload(payload: dict[str, Any]) -> tuple[dict[str, Any], int]:
    rel_path = _normalize_rel_path(payload.get("path"))
    fuzzy_match = None

    if not rel_path:
        return error_payload("path is required"), 400

    try:
        target = _resolve_workspace_path(rel_path)
    except ValueError as exc:
        return error_payload(str(exc)), 400

    if not target.exists():
        candidates = _find_fuzzy_path_matches(rel_path, limit=5)
        if not candidates:
            return error_payload("file not found"), 404
        fuzzy_match = candidates[0]
        target = _resolve_workspace_path(candidates[0]["path"])
    if not target.is_file():
        return error_payload("path must be a file"), 400
    if _should_skip_path(target):
        return error_payload("file type is not readable by code agent"), 400

    size = target.stat().st_size
    is_notebook = target.suffix.lower() == ".ipynb"
    if is_notebook and size > MAX_NOTEBOOK_BYTES:
        return error_payload(f"notebook is too large; limit is {MAX_NOTEBOOK_BYTES} bytes"), 413
    if not is_notebook and size > MAX_READ_BYTES:
        return error_payload(f"file is too large; limit is {MAX_READ_BYTES} bytes"), 413
    if not _is_text_file(target):
        return error_payload("file is not a text file"), 400

    try:
        text = _read_agent_text(target)
    except Exception:
        return error_payload("notebook could not be parsed as text"), 400

    if len(text.encode("utf-8", errors="replace")) > MAX_READ_BYTES:
        text = text.encode("utf-8", errors="replace")[:MAX_READ_BYTES].decode(
            "utf-8",
            errors="replace",
        )

    return success_payload(
        status="done",
        path=_rel(target),
        size=size,
        content=text,
        truncated=len(text.encode("utf-8", errors="replace")) >= MAX_READ_BYTES,
        fuzzy_match=fuzzy_match,
    ), 200


def search_code_payload(payload: dict[str, Any]) -> tuple[dict[str, Any], int]:
    query = str(payload.get("query") or payload.get("q") or "").strip()
    rel_path = _normalize_rel_path(payload.get("path"))
    pattern = str(payload.get("pattern") or "*").strip() or "*"
    max_results = min(
        int(payload.get("limit") or MAX_SEARCH_RESULTS),
        MAX_SEARCH_RESULTS,
    )

    if not query:
        return error_payload("query is required"), 400

    try:
        root = _resolve_workspace_path(rel_path)
    except ValueError as exc:
        return error_payload(str(exc)), 400

    if not root.exists():
        return error_payload("path not found"), 404
    if not root.is_dir():
        return error_payload("path must be a directory"), 400

    results = []
    query_lower = query.lower()
    path_matches = _find_fuzzy_path_matches(
        query,
        root=root,
        pattern=pattern,
        limit=min(max_results, MAX_PATH_MATCH_CANDIDATES),
    )

    for match in path_matches:
        results.append(
            {
                "path": match["path"],
                "line": None,
                "text": f"这是模糊匹配得到的路径，实际路径：{match['actual_path']}",
                "match_type": "path",
                "score": match["score"],
                "fuzzy_match": match,
            }
        )
        if len(results) >= max_results:
            break

    for path in _iter_readable_files(root, pattern):
        if len(results) >= max_results:
            break

        try:
            for index, line in enumerate(_read_agent_text(path).splitlines(), start=1):
                if query_lower not in line.lower():
                    continue
                results.append(
                    {
                        "path": _rel(path),
                        "line": index,
                        "text": line.strip(),
                        "match_type": "content",
                    }
                )
                if len(results) >= max_results:
                    break
        except Exception:
            continue

    return success_payload(
        status="done",
        query=query,
        path=rel_path,
        pattern=pattern,
        path_matches=[item for item in results if item.get("match_type") == "path"],
        results=results,
        truncated=len(results) >= max_results,
    ), 200
