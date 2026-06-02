from __future__ import annotations

import html
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from typing import Any

from config import OPENAI_MODEL
from services.llm_service import get_llm_client
from services.response_service import success_payload


DEFAULT_SEARCH_LIMIT = 12
MAX_SEARCH_LIMIT = 20
SEARCH_TIMEOUT_SECONDS = float(os.getenv("MIKI_SEARCH_TIMEOUT_SECONDS", "12"))
DDG_HTML_URL = "https://duckduckgo.com/html/"
BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"
SEARCH_SOURCE_PREFERENCE = """
Search/source preference:
- Prefer English-language sources unless the user explicitly asks for Chinese/local sources.
- Prefer high-trust primary or canonical sources.
- For encyclopedic background, prefer English Wikipedia.
- For research, physics, machine learning, math, algorithms, and technical topics, prefer arXiv, paper pages, conference/journal pages, university/lab pages, and official documentation.
- Deprioritize copied summaries, low-quality content farms, marketing pages, and unsourced forum posts.
""".strip()


def _search_model() -> str:
    return os.getenv("MIKI_SEARCH_MODEL") or os.getenv("MIKI_READER_MODEL") or OPENAI_MODEL


def _normalize_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _prefers_local_or_chinese_sources(query: str) -> bool:
    return bool(
        re.search(
            r"(中文|中国|国内|本地|日本|日文|日语|中文资料|中文网站|Chinese|China|Japan|Japanese)",
            query,
            re.IGNORECASE,
        )
    )


def _looks_research_or_technical(query: str) -> bool:
    return bool(
        re.search(
            r"(arxiv|paper|论文|研究|physics|物理|machine learning|机器学习|math|数学|algorithm|算法|neutrino|SIREN|model|模型|theorem|定理|conference|journal)",
            query,
            re.IGNORECASE,
        )
    )


def _build_preferred_search_query(query: str) -> str:
    if _prefers_local_or_chinese_sources(query):
        return query

    preference_terms = ["English sources", "Wikipedia", "official documentation"]
    if _looks_research_or_technical(query):
        preference_terms.extend(["arXiv", "paper"])

    return f"{query} {' '.join(preference_terms)}"


def _coerce_limit(value: Any) -> int:
    try:
        limit = int(value)
    except (TypeError, ValueError):
        limit = DEFAULT_SEARCH_LIMIT
    return max(1, min(limit, MAX_SEARCH_LIMIT))


def _http_json(url: str, *, headers: dict[str, str] | None = None) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "MikiAgentSearch/1.0",
            "Accept": "application/json",
            **(headers or {}),
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=SEARCH_TIMEOUT_SECONDS) as response:
            raw = response.read(2 * 1024 * 1024)
            return json.loads(raw.decode("utf-8", errors="ignore"))
    except urllib.error.URLError as exc:
        raise ValueError(f"search request failed: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError("search provider returned invalid JSON") from exc


def _http_text(url: str, *, headers: dict[str, str] | None = None) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "MikiAgentSearch/1.0",
            "Accept": "text/html,*/*",
            **(headers or {}),
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=SEARCH_TIMEOUT_SECONDS) as response:
            raw = response.read(3 * 1024 * 1024)
            return raw.decode("utf-8", errors="ignore")
    except urllib.error.URLError as exc:
        raise ValueError(f"search request failed: {exc}") from exc


class DuckDuckGoHTMLParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.results: list[dict[str, str]] = []
        self._current: dict[str, str] | None = None
        self._field: str | None = None
        self._chunks: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]):
        attr = {key: value or "" for key, value in attrs}
        classes = set((attr.get("class") or "").split())

        if tag == "a" and "result__a" in classes:
            self._flush_field()
            self._current = {
                "title": "",
                "url": _unwrap_ddg_url(attr.get("href", "")),
                "snippet": "",
            }
            self._field = "title"
            self._chunks = []
            return

        if self._current is not None and "result__snippet" in classes:
            self._flush_field()
            self._field = "snippet"
            self._chunks = []

    def handle_endtag(self, tag: str):
        if self._current is None:
            return

        if tag == "a" and self._field == "title":
            self._flush_field()
            return

        if tag == "a" and self._current.get("title") and self._current.get("url"):
            self._append_current()
            return

        if tag == "div" and self._field == "snippet":
            self._flush_field()

    def handle_data(self, data: str):
        if self._current is not None and self._field:
            self._chunks.append(data)

    def _flush_field(self):
        if self._current is None or not self._field:
            self._chunks = []
            return

        text = _clean_html_text(" ".join(self._chunks))
        if text:
            self._current[self._field] = text
        self._field = None
        self._chunks = []

    def _append_current(self):
        self._flush_field()
        if self._current and self._current.get("title") and self._current.get("url"):
            self.results.append(self._current)
        self._current = None
        self._field = None
        self._chunks = []


def _clean_html_text(text: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(text or "")).strip()


def _unwrap_ddg_url(url: str) -> str:
    if not url:
        return ""

    decoded = html.unescape(url)
    parsed = urllib.parse.urlparse(decoded)
    query = urllib.parse.parse_qs(parsed.query)
    uddg = query.get("uddg", [""])[0]
    return urllib.parse.unquote(uddg) if uddg else decoded


def _dedupe_results(results: list[dict[str, str]], limit: int) -> list[dict[str, str]]:
    deduped = []
    seen = set()

    for item in results:
        url = _normalize_text(item.get("url"))
        title = _normalize_text(item.get("title"))
        if not url or not title or url in seen:
            continue
        seen.add(url)
        deduped.append(
            {
                "title": title,
                "url": url,
                "snippet": _normalize_text(item.get("snippet")),
            }
        )
        if len(deduped) >= limit:
            break

    return deduped


def _search_brave(query: str, limit: int) -> list[dict[str, str]]:
    api_key = os.getenv("BRAVE_SEARCH_API_KEY", "").strip()
    if not api_key:
        return []

    params = urllib.parse.urlencode(
        {
            "q": query,
            "count": limit,
            "search_lang": os.getenv("MIKI_SEARCH_LANG", "en"),
            "country": os.getenv("MIKI_SEARCH_COUNTRY", "US"),
        }
    )
    data = _http_json(
        f"{BRAVE_SEARCH_URL}?{params}",
        headers={
            "X-Subscription-Token": api_key,
        },
    )
    raw_results = data.get("web", {}).get("results", [])
    results = []

    for item in raw_results:
        if not isinstance(item, dict):
            continue
        results.append(
            {
                "title": _clean_html_text(str(item.get("title") or "")),
                "url": str(item.get("url") or "").strip(),
                "snippet": _clean_html_text(str(item.get("description") or "")),
            }
        )

    return _dedupe_results(results, limit)


def _search_duckduckgo_html(query: str, limit: int) -> list[dict[str, str]]:
    params = urllib.parse.urlencode(
        {
            "q": query,
            "kl": os.getenv("MIKI_SEARCH_REGION", "us-en"),
        }
    )
    page = _http_text(f"{DDG_HTML_URL}?{params}")
    parser = DuckDuckGoHTMLParser()
    parser.feed(page)
    return _dedupe_results(parser.results, limit)


def _summarize_search_results(query: str, results: list[dict[str, str]]) -> str:
    if not results:
        return ""

    sources = "\n".join(
        f"{index + 1}. {item['title']}\nURL: {item['url']}\n摘要: {item.get('snippet') or '(none)'}"
        for index, item in enumerate(results)
    )
    prompt = f"""
用户搜索问题：
{query}

搜索结果：
{sources}

请用中文给出简洁回答。要求：
- 只基于搜索结果，不要编造搜索结果之外的信息。
- 标注你依赖了哪些编号来源。
- 优先依赖英文来源、高可信来源和一手来源；百科背景优先 Wikipedia，研究/技术问题优先 arXiv、论文页、会议/期刊页、大学/实验室页、官方文档。
- 如果搜索结果中没有这类优先来源，要直接说明当前结果来源质量有限。
- 如果结果不足以回答，直接说明还需要打开网页进一步核验。
""".strip()

    response = get_llm_client().chat.completions.create(
        model=_search_model(),
        messages=[
            {
                "role": "system",
                "content": "你是网页搜索结果整理助手，必须谨慎、可溯源、避免编造。",
            },
            {
                "role": "user",
                "content": prompt,
            },
        ],
        temperature=0.2,
        max_tokens=2400,
        stream=False,
    )

    return (response.choices[0].message.content or "").strip()


def web_search_payload(data: dict[str, Any]) -> dict[str, Any]:
    query = _normalize_text(data.get("query") or data.get("q"))
    if not query:
        raise ValueError("query is required")

    if os.getenv("MIKI_SEARCH_APPEND_SOURCE_PREFERENCE", "1").strip().lower() not in {"0", "false", "no"}:
        query_for_search = _build_preferred_search_query(query)
    else:
        query_for_search = query

    limit = _coerce_limit(data.get("limit"))
    summarize = bool(data.get("summarize", False))
    provider = _normalize_text(data.get("provider")).lower() or "auto"

    if provider not in {"auto", "brave", "duckduckgo"}:
        raise ValueError("provider must be one of auto, brave, duckduckgo")

    used_provider = ""
    errors: list[str] = []
    results: list[dict[str, str]] = []

    if provider in {"auto", "brave"}:
        try:
            results = _search_brave(query_for_search, limit)
            if results:
                used_provider = "brave"
        except Exception as exc:
            errors.append(f"brave: {exc}")
            if provider == "brave":
                raise

    if not results and provider in {"auto", "duckduckgo"}:
        try:
            results = _search_duckduckgo_html(query_for_search, limit)
            used_provider = "duckduckgo"
        except Exception as exc:
            errors.append(f"duckduckgo: {exc}")
            if provider == "duckduckgo":
                raise

    summary = _summarize_search_results(query, results) if summarize else ""

    return success_payload(
        status="done",
        query=query,
        search_query=query_for_search,
        source_preference=SEARCH_SOURCE_PREFERENCE,
        provider=used_provider or provider,
        results=results,
        summary=summary,
        warnings=errors,
    )
