from __future__ import annotations

import io
import json
import os
import re
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from pathlib import Path
from typing import Any

from config import API_DIR, OPENAI_MODEL
from services.llm_service import get_llm_client
from services.response_service import success_payload


MAX_UPLOAD_BYTES = int(os.getenv("MIKI_READER_MAX_UPLOAD_BYTES", str(18 * 1024 * 1024)))
MAX_REMOTE_BYTES = int(os.getenv("MIKI_READER_MAX_REMOTE_BYTES", str(18 * 1024 * 1024)))
MAX_PAPER_CHARS = int(os.getenv("MIKI_READER_MAX_PAPER_CHARS", "104000"))
UPLOAD_CACHE_DIR = API_DIR / "storage" / "uploads"
DEFAULT_PAPER_TASK = (
    "请阅读这篇论文/技术文档，输出中文总结，重点包括：核心问题、方法、关键贡献、"
    "实验或证据、局限性、以及我下一步应该关注什么。"
)
ARXIV_ID_PATTERN = re.compile(
    r"(?:arxiv\s*[:：]?\s*|arxiv\.org/(?:abs|pdf)/)?(\d{4}\.\d{4,5})(?:v\d+)?",
    re.IGNORECASE,
)


def _reader_model() -> str:
    return os.getenv("MIKI_READER_MODEL") or OPENAI_MODEL


def _normalize_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _compact_text(text: str, max_chars: int = MAX_PAPER_CHARS) -> str:
    compacted = re.sub(r"\s+", " ", text or "").strip()
    return compacted[:max_chars]


def _read_remote_bytes(url: str, max_bytes: int = MAX_REMOTE_BYTES) -> tuple[bytes, str]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "MikiAgentReader/1.0",
            "Accept": "application/pdf,text/plain,text/markdown,text/html,*/*",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            content_type = response.headers.get("Content-Type", "").split(";")[0].strip()
            chunks: list[bytes] = []
            total = 0

            while True:
                chunk = response.read(64 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise ValueError(f"remote file is too large; limit is {max_bytes} bytes")
                chunks.append(chunk)

            return b"".join(chunks), content_type
    except urllib.error.URLError as exc:
        raise ValueError(f"failed to fetch url: {exc}") from exc


def _guess_source_name(url: str = "", filename: str = "") -> str:
    if filename:
        return Path(filename).name
    if url:
        return Path(urllib.parse.urlparse(url).path).name or url
    return "uploaded-document"


def _safe_cache_filename(filename: str) -> str:
    name = Path(filename or "uploaded-document").name
    safe = re.sub(r"[^A-Za-z0-9._ -]+", "_", name).strip(" .")
    return safe or "uploaded-document"


def _cache_uploaded_file(raw: bytes, *, filename: str, content_type: str = "") -> dict[str, Any]:
    cache_id = uuid.uuid4().hex
    safe_name = _safe_cache_filename(filename)
    target_dir = UPLOAD_CACHE_DIR / cache_id
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / safe_name

    with target_path.open("wb") as f:
        f.write(raw)

    meta = {
        "id": cache_id,
        "name": safe_name,
        "original_name": filename or safe_name,
        "content_type": content_type or None,
        "size": len(raw),
        "path": str(target_path),
        "url": f"/api/agent/uploads/{cache_id}/{urllib.parse.quote(safe_name)}",
    }

    with (target_dir / "meta.json").open("w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    return meta


def _extract_arxiv_id(*values: str) -> str:
    for value in values:
        match = ARXIV_ID_PATTERN.search(value or "")
        if match:
            return match.group(1)
    return ""


def _arxiv_pdf_url(arxiv_id: str) -> str:
    return f"https://arxiv.org/pdf/{arxiv_id}.pdf"


def _extract_pdf_text(data: bytes) -> str:
    try:
        from pypdf import PdfReader  # type: ignore
    except Exception:
        try:
            from PyPDF2 import PdfReader  # type: ignore
        except Exception as exc:
            raise RuntimeError(
                "PDF text extraction requires pypdf or PyPDF2. Install one of them, "
                "or send extracted text/plain content instead."
            ) from exc

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=True) as tmp:
        tmp.write(data)
        tmp.flush()
        reader = PdfReader(tmp.name)
        pages = []
        for page in reader.pages[:80]:
            pages.append(page.extract_text() or "")
        return "\n\n".join(pages).strip()


def _extract_docx_text(data: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            xml = archive.read("word/document.xml").decode("utf-8", errors="ignore")
    except KeyError as exc:
        raise ValueError("invalid docx file: word/document.xml not found") from exc
    except zipfile.BadZipFile as exc:
        raise ValueError("invalid docx file") from exc

    xml = re.sub(r"</w:p\s*>", "\n", xml)
    xml = re.sub(r"</w:tr\s*>", "\n", xml)
    text = re.sub(r"<[^>]+>", "", xml)
    text = (
        text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", '"')
        .replace("&apos;", "'")
    )
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _extract_html_text(data: bytes) -> str:
    raw = data.decode("utf-8", errors="ignore")
    raw = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", raw)
    raw = re.sub(r"(?s)<[^>]+>", " ", raw)
    return re.sub(r"\s+", " ", raw).strip()


def _extract_document_text(data: bytes, *, content_type: str = "", filename: str = "") -> str:
    suffix = Path(filename or "").suffix.lower()
    normalized_type = (content_type or "").lower()

    if suffix == ".pdf" or "pdf" in normalized_type:
        return _extract_pdf_text(data)

    if (
        suffix == ".docx"
        or "officedocument.wordprocessingml.document" in normalized_type
    ):
        return _extract_docx_text(data)

    if suffix == ".doc" or normalized_type == "application/msword":
        raise ValueError("legacy .doc is not supported; please convert it to .docx, PDF, or txt")

    if suffix in {".txt", ".md", ".markdown", ".tex", ".csv", ".json"} or normalized_type.startswith("text/"):
        return data.decode("utf-8", errors="ignore").strip()

    if suffix in {".html", ".htm"} or "html" in normalized_type:
        return _extract_html_text(data)

    try:
        return data.decode("utf-8").strip()
    except UnicodeDecodeError as exc:
        raise ValueError(
            "unsupported document type; supported inputs are PDF, DOCX, txt, markdown, TeX, CSV, JSON, and HTML"
        ) from exc


def _json_completion(system_prompt: str, user_prompt: str, *, model: str, max_tokens: int) -> dict[str, Any]:
    response = get_llm_client().chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.2,
        max_tokens=max_tokens,
        stream=False,
    )
    text = response.choices[0].message.content or ""
    cleaned = text.strip()

    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    return {
        "summary": cleaned,
        "key_points": [],
        "limitations": [],
        "next_steps": [],
    }


def summarize_paper_payload(data: dict[str, Any], file_storage=None) -> dict[str, Any]:
    task = _normalize_text(data.get("task")) or DEFAULT_PAPER_TASK
    source_url = _normalize_text(data.get("url"))
    arxiv_id = _extract_arxiv_id(_normalize_text(data.get("arxiv_id")), source_url)
    inline_text = _normalize_text(data.get("text"))

    if arxiv_id and not source_url and not inline_text and file_storage is None:
        source_url = _arxiv_pdf_url(arxiv_id)
    elif arxiv_id and source_url and "arxiv.org/abs/" in source_url:
        source_url = _arxiv_pdf_url(arxiv_id)

    source_name = _guess_source_name(source_url, getattr(file_storage, "filename", "") or "")
    content_type = ""
    cached_upload = None

    if inline_text:
        extracted_text = inline_text
    else:
        if file_storage is not None:
            raw = file_storage.read(MAX_UPLOAD_BYTES + 1)
            if len(raw) > MAX_UPLOAD_BYTES:
                raise ValueError(f"uploaded file is too large; limit is {MAX_UPLOAD_BYTES} bytes")
            content_type = file_storage.mimetype or ""
            source_name = _guess_source_name(filename=file_storage.filename or source_name)
            cached_upload = _cache_uploaded_file(
                raw,
                filename=file_storage.filename or source_name,
                content_type=content_type,
            )
        elif source_url:
            raw, content_type = _read_remote_bytes(source_url)
        else:
            raise ValueError("one of text, url, or file is required")

        extracted_text = _extract_document_text(
            raw,
            content_type=content_type,
            filename=source_name,
        )

    compacted = _compact_text(extracted_text)
    if not compacted:
        raise ValueError("no readable text was extracted from the document")

    system_prompt = (
        "你是严谨的论文阅读助手。必须只基于用户提供的文档内容回答；"
        "如果证据不足，要明确说不确定。请返回 JSON，不要输出 markdown。"
    )
    user_prompt = f"""
任务：
{task}

请返回 JSON，字段为：
- summary: string
- problem: string
- method: string
- contributions: string[]
- evidence: string[]
- limitations: string[]
- next_steps: string[]
- terms: string[]

文档来源：{source_name}
文档正文（可能被截断）：
{compacted}
""".strip()

    result = _json_completion(
        system_prompt,
        user_prompt,
        model=_reader_model(),
        max_tokens=5200,
    )

    return success_payload(
        status="done",
        source={
            "name": source_name,
            "url": source_url or None,
            "arxiv_id": arxiv_id or None,
            "content_type": content_type or None,
            "text_chars": len(extracted_text),
            "used_chars": len(compacted),
            "truncated": len(extracted_text) > len(compacted),
            "cache": cached_upload,
        },
        result=result,
        raw_text_preview=compacted[:3200],
    )
