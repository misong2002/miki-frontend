import json
import re
import time
from typing import Any, Generator

from config import (
    OPENAI_FAST_MODEL,
    OPENAI_THINKING_MODEL,
    PROFILE_BUNDLE_MAX_FACTS,
)
from memory.memory_store import get_long_term_db, list_idea_tag_catalog
from services.agent_reader_service import summarize_paper_payload
from services.agent_search_service import web_search_payload
from services.code_agent_service import (
    list_code_files_payload,
    read_code_file_payload,
    search_code_payload,
)
from services.llm_service import get_llm_client
from services.memory_service import (
    append_message,
    get_recent_messages,
)
from services.persona_service import get_system_prompt
from services.response_service import error_payload
from services.train_service import read_train_config


MAX_RETRIEVED_LONG_TERM_ITEMS = 16
MAX_MEMORY_RETRIEVE_TOOL_ITEMS = 24
MAX_RETRIEVAL_HISTORY_MESSAGES = 6
MAX_PROMPT_HISTORY_MESSAGES = 36
MAX_PROMPT_MESSAGE_CHARS = 20000
DEFAULT_MAX_COMPLETION_TOKENS = 6000
EXTENDED_MAX_COMPLETION_TOKENS = 20000
INTERACTION_PROMPT_HISTORY_MESSAGES = 24
INTERACTION_PROMPT_MESSAGE_CHARS = 3600
INTERACTION_MAX_COMPLETION_TOKENS = 1200
MAX_BACKEND_TOOL_CALLS_PER_TURN = 6
HIDDEN_CONTROL_TEXT_RE = re.compile(
    r"<<\s*(?:emotion|motion)\s*:\s*[a-zA-Z0-9_-]*\s*>>"
    r"|<<\s*config:set\s+[A-Za-z0-9_.]+\s*=\s*[\s\S]*?\s*>>"
    r"|<<\s*initialization_ready\s*>>"
    r"|\[\[\s*use_tool\s*:\s*\{[\s\S]*?\}\s*\]\]"
    r"|\[\[\s*say\s*:[\s\S]*?\]\]",
    re.IGNORECASE,
)
GENERIC_QUERY_TERMS = {
    "我们",
    "你们",
    "之前",
    "刚才",
    "上次",
    "那个",
    "这个",
    "这件事",
    "这部分",
    "现在",
    "怎么",
    "怎么样",
    "什么",
    "为啥",
    "为什么",
    "一下",
    "一下子",
    "还有",
    "那边",
}
MEMORY_RECALL_TRIGGER_TERMS = [
    "记得",
    "回想",
    "之前",
    "那个 idea",
    "那个idea",
    "还记得吗",
    "还记得",
    "idea",
    "physics-informed",
    "physics informed",
    "machine learning",
    "machine_learning",
    "ideas",
    "想法",
    "点子",
    "研究想法",
    "个人信息",
    "个人情况",
    "对我的印象",
    "你对我的印象",
    "我是什么样的人",
    "你觉得我",
    "我的背景",
    "背景",
    "我的经历",
    "经历",
    "我的偏好",
    "偏好",
    "喜好",
    "我的研究兴趣",
    "研究兴趣",
    "研究方向",
    "我的研究风格",
    "研究风格",
    "我的目标",
    "长期目标",
    "项目情况",
    "正在做什么",
]
FACT_CATEGORY_TRIGGER_ALIASES = {
    "identity": ["身份", "个人信息", "你对我的印象", "对我的印象", "我是什么样的人"],
    "background": ["背景", "个人背景", "经历", "过去经历"],
    "major_life_event": ["重要经历", "人生经历", "经历"],
    "research_interest": ["研究兴趣", "研究方向", "感兴趣", "machine learning", "physics-informed"],
    "research_style": ["研究风格", "做研究的方式"],
    "preference": ["偏好", "喜好", "口味"],
    "long_term_goal": ["长期目标", "目标", "计划"],
    "project_context": ["项目", "项目情况", "正在做什么", "最近在做什么"],
}
IDEA_CATEGORY_TRIGGER_ALIASES = {
    "system_design": ["系统设计", "设计思路", "架构想法"],
    "engineering": ["工程", "实现思路"],
    "machine_learning": ["machine learning", "ml", "机器学习"],
    "physics": ["physics", "物理", "理论物理"],
    "numerical_methods": ["数值方法", "数值计算"],
    "philosophy_of_science": ["科学哲学", "方法论"],
}
PROFILE_GENERAL_TRIGGER_TERMS = [
    "你对我的印象",
    "对我的印象",
    "你觉得我",
    "我是什么样的人",
    "个人信息",
    "个人情况",
    "我的情况",
    "我的画像",
    "我的人格",
]
PROJECT_TRIGGER_TERMS = [
    "最近在做什么",
    "正在做什么",
    "项目情况",
    "项目进展",
    "项目状态",
    "做到哪了",
    "进展怎么样",
    "下一步",
]
SESSION_TRIGGER_TERMS = [
    "之前聊到哪",
    "上次聊到哪",
    "我们之前聊了什么",
    "之前说了什么",
    "上次说了什么",
    "回顾一下",
    "总结一下之前",
]
IDEA_CATALOG_TRIGGER_TERMS = [
    "有哪些 ideas",
    "有哪些ideas",
    "有哪些 idea",
    "有哪些idea",
    "有哪些想法",
    "你有哪些想法",
    "你的想法列表",
    "idea 列表",
    "idea列表",
    "想法列表",
    "所有 idea",
    "所有idea",
    "所有想法",
]
PROFILE_FACT_CATEGORIES = [
    "identity",
    "background",
    "major_life_event",
    "research_interest",
    "research_style",
    "preference",
    "long_term_goal",
]


def _normalize_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return "\n".join(_normalize_text(item) for item in value)
    return str(value).strip()


def _strip_hidden_control_text(value: Any) -> str:
    text = _normalize_text(value)
    if not text:
        return ""
    text = HIDDEN_CONTROL_TEXT_RE.sub("", text)
    text = re.sub(r"^[ \t]+\n", "", text, flags=re.MULTILINE)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _is_active_memory(item: dict[str, Any]) -> bool:
    return str(item.get("memory_status") or "active").strip().lower() == "active"


def _active_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [item for item in items if isinstance(item, dict) and _is_active_memory(item)]


def _unique_preserve_order(items: list[str]) -> list[str]:
    seen = set()
    result = []

    for item in items:
        normalized = item.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)

    return result


def _extract_query_keywords(text: str) -> list[str]:
    raw = _normalize_text(text)
    if not raw:
        return []

    raw_lower = raw.lower()
    db = get_long_term_db()

    latin_tokens = [
        token.lower()
        for token in re.findall(r"[A-Za-z][A-Za-z0-9_./+-]{1,31}", raw)
    ]
    cjk_chunks = re.findall(r"[\u4e00-\u9fff]{2,16}", raw)

    cjk_tokens: list[str] = []
    for chunk in cjk_chunks:
        cjk_tokens.append(chunk)
        if len(chunk) > 4:
            cjk_tokens.extend(chunk[i : i + 4] for i in range(0, len(chunk) - 3))

    trigger_tokens = [
        trigger
        for trigger in (
            MEMORY_RECALL_TRIGGER_TERMS
            + _build_fact_category_trigger_terms(db)
            + _build_idea_category_trigger_terms(db)
        )
        if trigger.casefold() in raw_lower
    ]

    matched_idea_tags = []
    for tag in list_idea_tag_catalog():
        tag_text = str(tag).strip()
        if not tag_text:
            continue
        if tag_text.casefold() in raw_lower:
            matched_idea_tags.append(tag_text)

    filtered = [
        token
        for token in _unique_preserve_order(
            trigger_tokens + matched_idea_tags + latin_tokens + cjk_tokens
        )
        if token and token not in GENERIC_QUERY_TERMS
    ]

    return filtered[:24]


def _build_fact_category_trigger_terms(db: dict[str, Any]) -> list[str]:
    categories = {
        str(item.get("category") or "").strip()
        for item in _active_items(db.get("user_facts", []))
        if str(item.get("category") or "").strip()
    }

    tokens = []
    for category in sorted(categories):
        tokens.append(category)
        tokens.append(category.replace("_", " "))
        tokens.extend(FACT_CATEGORY_TRIGGER_ALIASES.get(category, []))

    return tokens


def _build_idea_category_trigger_terms(db: dict[str, Any]) -> list[str]:
    categories = {
        str(item.get("category") or "").strip()
        for item in _active_items(db.get("idea_memories", []))
        if str(item.get("category") or "").strip()
    }

    tokens = ["idea", "ideas", "想法", "研究想法", "点子"]
    for category in sorted(categories):
        tokens.append(category)
        tokens.append(category.replace("_", " "))
        category_lower = category.lower()
        for key, aliases in IDEA_CATEGORY_TRIGGER_ALIASES.items():
            if key in category_lower:
                tokens.extend(aliases)

    return tokens


def _match_trigger_terms(query_lower: str, trigger_terms: list[str]) -> list[str]:
    return [term for term in trigger_terms if term.casefold() in query_lower]


def _detect_profile_fact_categories(
    query_text: str,
    db: dict[str, Any],
) -> list[str]:
    query_lower = query_text.lower()
    available_categories = {
        str(item.get("category") or "").strip()
        for item in _active_items(db.get("user_facts", []))
        if str(item.get("category") or "").strip()
    }

    matched = []
    for category in PROFILE_FACT_CATEGORIES:
        if category not in available_categories:
            continue

        aliases = FACT_CATEGORY_TRIGGER_ALIASES.get(category, [])
        if any(alias.casefold() in query_lower for alias in aliases):
            matched.append(category)

    if matched:
        return matched

    if _match_trigger_terms(query_lower, PROFILE_GENERAL_TRIGGER_TERMS):
        return [category for category in PROFILE_FACT_CATEGORIES if category in available_categories]

    return []


def _collect_item_tags(item: dict[str, Any]) -> list[str]:
    tags = item.get("tags") or []
    if not isinstance(tags, list):
        return []
    return [str(tag).strip() for tag in tags if str(tag).strip()]


def _collect_item_text_parts(item_type: str, item: dict[str, Any]) -> list[str]:
    if item_type == "fact":
        return [
            item.get("key", ""),
            item.get("value", ""),
            item.get("category", ""),
            _collect_item_tags(item),
        ]

    if item_type == "idea":
        return [
            item.get("title", ""),
            item.get("content", ""),
            item.get("category", ""),
            item.get("open_questions", []),
            _collect_item_tags(item),
        ]

    if item_type == "project":
        return [
            item.get("project_key", ""),
            item.get("title", ""),
            item.get("summary", ""),
            item.get("recent_changes", []),
            item.get("next_steps", []),
            _collect_item_tags(item),
        ]

    if item_type == "summary":
        return [
            item.get("summary", ""),
            item.get("topics", []),
            item.get("open_loops", []),
            item.get("resolved_items", []),
            _collect_item_tags(item),
        ]

    if item_type == "digest":
        return [
            item.get("type", ""),
            item.get("content", ""),
            _collect_item_tags(item),
        ]

    return []


def _score_memory_item(
    item_type: str,
    item: dict[str, Any],
    keywords: list[str],
    query_text: str,
) -> dict[str, Any]:
    if not keywords:
        return {
            "score": 0.0,
            "matched_keywords": [],
            "matched_tags": [],
            "matched_fields": [],
        }

    haystack = _normalize_text(_collect_item_text_parts(item_type, item)).lower()
    tags = [tag.lower() for tag in _collect_item_tags(item)]
    query_lower = query_text.lower()

    score = 0.0
    matched_keywords = set()
    matched_tags = set()
    matched_fields = set()

    type_bonus = {
        "fact": 1.4,
        "project": 1.2,
        "idea": 1.1,
        "summary": 0.9,
        "digest": 0.5,
    }
    score += type_bonus.get(item_type, 0.0)

    for keyword in keywords:
        if len(keyword) < 2:
            continue

        if keyword in tags:
            score += 8.0
            matched_keywords.add(keyword)
            matched_tags.add(keyword)
            continue

        if any(keyword in tag or tag in keyword for tag in tags):
            score += 5.0
            matched_keywords.add(keyword)
            matched_tags.add(keyword)

        if len(keyword) >= 4 and keyword in haystack:
            score += 2.2
            matched_keywords.add(keyword)
            matched_fields.add("text")

    if item.get("pinned"):
        score += 1.5

    confidence = item.get("confidence")
    if isinstance(confidence, (int, float)):
        score += min(float(confidence), 1.0)

    importance = item.get("importance")
    if isinstance(importance, (int, float)):
        score += min(float(importance), 1.0) * 0.8

    novelty = item.get("novelty")
    if isinstance(novelty, (int, float)):
        score += min(float(novelty), 1.0) * 0.3

    if item_type == "summary":
        topic_text = " ".join(item.get("topics", []))
        if topic_text and any(keyword in topic_text.lower() for keyword in keywords):
            score += 1.2
            matched_fields.add("topics")

    if any(
        cue in query_lower
        for cue in [
            "刚才",
            "之前",
            "上次",
            "继续",
            "那个",
            "这件事",
            "这部分",
            "记得",
            "回想",
            "还记得",
            "idea",
            "machine learning",
            "physics-informed",
        ]
    ):
        if item_type in {"summary", "project"}:
            score += 0.8
        if item_type == "idea":
            score += 2.0

    return {
        "score": score,
        "matched_keywords": sorted(matched_keywords),
        "matched_tags": sorted(matched_tags),
        "matched_fields": sorted(matched_fields),
    }


def _build_retrieval_debug_payload(
    query_text: str,
    keywords: list[str],
    retrieved_items: list[dict[str, Any]],
    *,
    level: str,
    strategy: str,
    matched_triggers: list[str] | None = None,
) -> dict[str, Any]:
    hits = []
    for item in retrieved_items:
        payload = item["item"]
        label = (
            payload.get("title")
            or payload.get("value")
            or payload.get("summary", "")[:80]
            or payload.get("type", "")
        )
        hits.append(
            {
                "type": item["type"],
                "score": round(float(item.get("score", 0.0)), 2),
                "label": label,
                "matched_keywords": item.get("matched_keywords", []),
                "matched_tags": item.get("matched_tags", []),
                "matched_fields": item.get("matched_fields", []),
            }
        )

    return {
        "level": level,
        "strategy": strategy,
        "query": query_text,
        "sensed_keywords": keywords,
        "matched_triggers": matched_triggers or [],
        "hits": hits,
    }

def _format_retrieved_memory_block(
    retrieved_items: list[dict[str, Any]],
    *,
    level: str = "generic",
) -> str:
    if not retrieved_items:
        return ""

    if level == "profile":
        lines = [
            "以下内容是用户长期画像相关记忆。用户正在询问你对TA的印象、背景或整体认识，应优先综合这些信息来回答。"
        ]
    elif level == "project":
        lines = [
            "以下内容是用户当前项目与近期进展相关记忆。用户在问最近在做什么、项目状态或下一步。"
        ]
    elif level == "session_recall":
        lines = [
            "以下内容是近期对话回顾。用户在问之前聊过什么或上次推进到哪里。"
        ]
    elif level == "idea_catalog":
        lines = [
            "以下内容是用户长期 idea 列表与研究想法。用户在询问有哪些想法或 ideas。"
        ]
    else:
        lines = [
            "以下内容是从长期记忆库按当前问题检索出的候选记忆，只在确实相关时使用，不要生硬复述。"
        ]

    for item in retrieved_items:
        item_type = item["type"]
        payload = item["item"]

        if item_type == "fact":
            lines.append(f"- 长期事实: {payload.get('value', '').strip()}")
        elif item_type == "project":
            summary = payload.get("summary", "").strip()
            next_steps = payload.get("next_steps", [])
            block = f"- 项目 {payload.get('title', '').strip()}: {summary}"
            if next_steps:
                block += f" 当前下一步: {next_steps[0]}"
            lines.append(block.strip())
        elif item_type == "idea":
            title = payload.get("title", "").strip()
            content = payload.get("content", "").strip()
            lines.append(f"- 想法 {title}: {content[:180]}")
        elif item_type == "summary":
            summary = payload.get("summary", "").strip()
            lines.append(f"- 历史摘要: {summary[:180]}")
        elif item_type == "digest":
            content = payload.get("content", "").strip()
            if content:
                lines.append(f"- 核心记忆摘要: {content[:220]}")

    return "\n".join(lines).strip()


def _build_retrieval_query(
    history: list[dict[str, str]],
    user_message: str,
    *,
    history_limit: int = MAX_RETRIEVAL_HISTORY_MESSAGES,
) -> str:
    recent_history = history[-history_limit:] if history_limit > 0 else []
    lines = []

    for msg in recent_history:
        role = msg.get("role", "unknown")
        content = _normalize_text(msg.get("content", ""))
        if not content:
            continue
        lines.append(f"{role}: {content[:160]}")

    lines.append(f"user: {user_message.strip()}")
    return "\n".join(lines).strip()


def _build_prompt_history(
    history: list[dict[str, str]],
    *,
    limit: int = MAX_PROMPT_HISTORY_MESSAGES,
    max_chars_per_message: int = MAX_PROMPT_MESSAGE_CHARS,
) -> list[dict[str, str]]:
    recent_history = history[-limit:] if limit > 0 else []
    prompt_history: list[dict[str, str]] = []

    for msg in recent_history:
        role = str(msg.get("role", "")).strip()
        if role not in {"user", "assistant", "system"}:
            continue

        content = _normalize_text(msg.get("content", ""))
        if not content:
            continue

        if max_chars_per_message > 0:
            content = content[:max_chars_per_message]

        prompt_history.append({
            "role": role,
            "content": content,
        })

    return prompt_history


def _classify_memory_query_level(
    query_text: str,
    db: dict[str, Any],
) -> tuple[str, str, list[str], list[str]]:
    query_lower = query_text.lower()
    matched_profile_categories = _detect_profile_fact_categories(query_text, db)
    matched_profile_triggers = _match_trigger_terms(query_lower, PROFILE_GENERAL_TRIGGER_TERMS)
    matched_project_triggers = _match_trigger_terms(query_lower, PROJECT_TRIGGER_TERMS)
    matched_session_triggers = _match_trigger_terms(query_lower, SESSION_TRIGGER_TERMS)
    matched_idea_catalog_triggers = _match_trigger_terms(query_lower, IDEA_CATALOG_TRIGGER_TERMS)

    if matched_idea_catalog_triggers:
        return "idea_catalog", "idea_catalog_bundle", [], matched_idea_catalog_triggers

    if matched_profile_categories or matched_profile_triggers:
        return "profile", "user_profile_bundle", matched_profile_categories, matched_profile_triggers

    if matched_project_triggers:
        return "project", "project_bundle", [], matched_project_triggers

    if matched_session_triggers:
        return "session_recall", "session_bundle", [], matched_session_triggers

    entity_keywords = _extract_query_keywords(query_text)
    if any(keyword.casefold() == tag.casefold() for keyword in entity_keywords for tag in list_idea_tag_catalog()):
        return "entity", "targeted_entity_retrieval", [], []

    return "generic", "scored_retrieval", [], []


def _make_selected_item(
    item_type: str,
    item: dict[str, Any],
    *,
    score: float = 100.0,
    matched_keywords: list[str] | None = None,
    matched_tags: list[str] | None = None,
    matched_fields: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "type": item_type,
        "item": item,
        "score": score,
        "matched_keywords": matched_keywords or [],
        "matched_tags": matched_tags or [],
        "matched_fields": matched_fields or [],
        "updated_at": item.get("updated_at", 0),
    }


def _retrieve_profile_bundle(
    db: dict[str, Any],
    selected_categories: list[str],
) -> list[dict[str, Any]]:
    facts = _active_items(db.get("user_facts", []))
    categories = set(selected_categories or PROFILE_FACT_CATEGORIES)

    selected = [
        _make_selected_item(
            "fact",
            fact,
            score=100.0,
            matched_fields=["category_bundle"],
        )
        for fact in facts
        if fact.get("category") in categories
    ]

    selected.sort(key=lambda x: (x["item"].get("pinned", False), x["updated_at"]), reverse=True)
    return selected[:PROFILE_BUNDLE_MAX_FACTS]


def _retrieve_project_bundle(db: dict[str, Any]) -> list[dict[str, Any]]:
    selected = []
    for project in _active_items(db.get("project_states", [])):
        selected.append(_make_selected_item("project", project, score=100.0, matched_fields=["project_bundle"]))

    for fact in _active_items(db.get("user_facts", [])):
        if fact.get("category") == "project_context":
            selected.append(_make_selected_item("fact", fact, score=90.0, matched_fields=["project_context"]))

    summaries = sorted(
        db.get("session_summaries", []),
        key=lambda item: item.get("updated_at", 0),
        reverse=True,
    )[:8]
    for summary in summaries:
        selected.append(_make_selected_item("summary", summary, score=80.0, matched_fields=["recent_summary"]))

    return selected[:24]


def _retrieve_session_bundle(db: dict[str, Any]) -> list[dict[str, Any]]:
    summaries = sorted(
        db.get("session_summaries", []),
        key=lambda item: item.get("updated_at", 0),
        reverse=True,
    )[:16]
    selected = [
        _make_selected_item("summary", summary, score=100.0, matched_fields=["recent_summary"])
        for summary in summaries
    ]
    return selected


def _retrieve_idea_catalog_bundle(db: dict[str, Any]) -> list[dict[str, Any]]:
    ideas = sorted(
        _active_items(db.get("idea_memories", [])),
        key=lambda item: (
            float(item.get("importance", 0.0)),
            float(item.get("novelty", 0.0)),
            item.get("updated_at", 0),
        ),
        reverse=True,
    )[:20]
    return [
        _make_selected_item("idea", idea, score=100.0, matched_fields=["idea_catalog"])
        for idea in ideas
    ]


def build_memory_context(
    query_text: str,
    *,
    limit: int = MAX_RETRIEVED_LONG_TERM_ITEMS,
) -> dict[str, Any]:
    db = get_long_term_db()
    keywords = _extract_query_keywords(query_text)
    level, strategy, selected_categories, matched_triggers = _classify_memory_query_level(
        query_text,
        db,
    )

    if level == "profile":
        retrieved = _retrieve_profile_bundle(db, selected_categories)
    elif level == "project":
        retrieved = _retrieve_project_bundle(db)
    elif level == "session_recall":
        retrieved = _retrieve_session_bundle(db)
    elif level == "idea_catalog":
        retrieved = _retrieve_idea_catalog_bundle(db)
    else:
        retrieved = retrieve_relevant_long_term_memories(query_text, limit=limit)

    if limit > 0:
        retrieved = retrieved[:limit]

    return {
        "level": level,
        "strategy": strategy,
        "keywords": keywords,
        "matched_triggers": matched_triggers,
        "retrieved": retrieved,
        "memory_block": _format_retrieved_memory_block(retrieved, level=level),
        "debug_retrieval": _build_retrieval_debug_payload(
            query_text,
            keywords,
            retrieved,
            level=level,
            strategy=strategy,
            matched_triggers=matched_triggers,
        ),
    }


def retrieve_relevant_long_term_memories(
    query_text: str,
    *,
    limit: int = MAX_RETRIEVED_LONG_TERM_ITEMS,
) -> list[dict[str, Any]]:
    db = get_long_term_db()
    keywords = _extract_query_keywords(query_text)

    if not keywords:
        return []

    candidates: list[dict[str, Any]] = []
    collections = [
        ("fact", _active_items(db.get("user_facts", []))),
        ("project", _active_items(db.get("project_states", []))),
        ("idea", _active_items(db.get("idea_memories", []))),
        ("summary", db.get("session_summaries", [])),
        ("digest", db.get("memory_digests", [])),
    ]

    for item_type, items in collections:
        for item in items:
            match_result = _score_memory_item(item_type, item, keywords, query_text)
            score = float(match_result["score"])
            if score < 2.5:
                continue

            candidates.append(
                {
                    "type": item_type,
                    "item": item,
                    "score": score,
                    "matched_keywords": match_result["matched_keywords"],
                    "matched_tags": match_result["matched_tags"],
                    "matched_fields": match_result["matched_fields"],
                    "updated_at": item.get("updated_at", 0),
                }
            )

    candidates.sort(
        key=lambda x: (x["score"], x["updated_at"]),
        reverse=True,
    )

    selected = []
    type_limits = {
        "fact": 4,
        "project": 4,
        "idea": 4,
        "summary": 4,
        "digest": 2,
    }
    type_counts: dict[str, int] = {}

    for candidate in candidates:
        item_type = candidate["type"]
        current_count = type_counts.get(item_type, 0)
        if current_count >= type_limits.get(item_type, 1):
            continue

        selected.append(candidate)
        type_counts[item_type] = current_count + 1

        if len(selected) >= limit:
            break

    return selected


def get_long_term_memory_retrieval_payload(
    query_text: str,
    *,
    limit: int = MAX_RETRIEVED_LONG_TERM_ITEMS,
) -> dict[str, Any]:
    context = build_memory_context(query_text, limit=limit)
    return {
        "ok": True,
        "query": query_text,
        "level": context["level"],
        "strategy": context["strategy"],
        "keywords": context["keywords"],
        "matched_triggers": context["matched_triggers"],
        "retrieved": context["retrieved"][:limit],
        "memory_block": _format_retrieved_memory_block(
            context["retrieved"][:limit],
            level=context["level"],
        ),
        "debug_retrieval": {
            **context["debug_retrieval"],
            "hits": context["debug_retrieval"]["hits"][:limit],
        },
    }


def build_chat_messages(
    user_message: str,
    session_id: str | None = None,
    *,
    message_type: str = "user",
) -> tuple[list[dict[str, str]], dict[str, Any]]:
    is_interaction = message_type == "interaction"
    history_limit = (
        INTERACTION_PROMPT_HISTORY_MESSAGES
        if is_interaction
        else MAX_PROMPT_HISTORY_MESSAGES
    )
    max_history_chars = (
        INTERACTION_PROMPT_MESSAGE_CHARS
        if is_interaction
        else MAX_PROMPT_MESSAGE_CHARS
    )
    history = get_recent_messages(limit=history_limit, session_id=session_id)

    retrieval_query = _build_retrieval_query(history, user_message)
    context = build_memory_context(retrieval_query)

    retrieved_memory_block = context["memory_block"]
    prompt_history = _build_prompt_history(
        history,
        limit=history_limit,
        max_chars_per_message=max_history_chars,
    )

    messages = [
        {"role": "system", "content": get_system_prompt()}
    ]

    if retrieved_memory_block:
        messages.append({
            "role": "system",
            "content": f"（用户的问题让你想起了：\n{retrieved_memory_block}\n）",
        })

    if is_interaction:
        messages.append({
            "role": "system",
            "content": (
                "当前用户消息是一次 Live2D 日常互动，不是新会话。"
                "必须结合最近对话和已注入记忆回应，不要表现得像失忆或第一次被这样互动。"
                "如果近期已经发生过类似摸头/互动，要承认连续性并自然变化措辞，不要重复固定模板、固定寒暄或固定问句。"
                "仍然必须用开头 emotion/motion 控制符表达表情动作；不要输出任何可见括号动作描写。"
            ),
        })

    messages.extend(prompt_history)
    messages.append({
        "role": "user",
        "content": user_message,
    })

    return messages, {
        **context["debug_retrieval"],
        "injected_memory_block": retrieved_memory_block,
        "injected_short_term_history_count": len(prompt_history),
    }


def choose_max_completion_tokens(user_message: str, message_type: str = "user") -> int:
    if message_type == "interaction":
        return INTERACTION_MAX_COMPLETION_TOKENS

    if requires_thinking_model(user_message, message_type=message_type):
        return EXTENDED_MAX_COMPLETION_TOKENS

    return DEFAULT_MAX_COMPLETION_TOKENS


def requires_thinking_model(user_message: str, message_type: str = "user") -> bool:
    if message_type == "interaction":
        return False

    text = _normalize_text(user_message).lower()
    thinking_triggers = [
        "证明",
        "推导",
        "数学",
        "严格",
        "详细",
        "完整",
        "长一点",
        "展开",
        "论证",
        "derive",
        "derivation",
        "proof",
        "prove",
        "math",
        "rigorous",
        "detailed",
        "in detail",
        "step by step",
        "long",
        "explain fully",
    ]

    return any(trigger in text for trigger in thinking_triggers)


def choose_chat_model(user_message: str, message_type: str = "user") -> str:
    if requires_thinking_model(user_message, message_type=message_type):
        return OPENAI_THINKING_MODEL

    return OPENAI_FAST_MODEL


def get_chat_model_mode(model_name: str) -> str:
    if model_name == OPENAI_THINKING_MODEL:
        return "pro"
    return "fast"


def _backend_tool_schema(
    name: str,
    description: str,
    properties: dict[str, Any] | None = None,
    required: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties or {},
                "required": required or [],
                "additionalProperties": False,
            },
        },
    }


BACKEND_CHAT_TOOLS: list[dict[str, Any]] = [
    _backend_tool_schema(
        "web_search",
        "查最新信息、网页资料、新闻或外部资料。用户明确要求联网、最新、新闻、外部资料时使用。",
        {
            "query": {"type": "string", "description": "搜索 query，优先英文和一手来源关键词。"},
            "limit": {"type": "integer", "description": "返回结果数量，默认 5。"},
        },
        ["query"],
    ),
    _backend_tool_schema(
        "read_document",
        "读取文档 URL 或 arXiv 论文。注意：上传文件仍由前端附件流程处理。",
        {
            "url": {"type": "string", "description": "文档 URL，可为空。"},
            "arxiv_id": {"type": "string", "description": "arXiv ID，可为空。"},
            "task": {"type": "string", "description": "阅读任务。"},
        },
    ),
    _backend_tool_schema(
        "code_search",
        "在本地 MIKI 项目里搜索代码、notebook、配置、文档、函数、调用链、训练循环或实现逻辑。",
        {
            "query": {"type": "string", "description": "代码搜索关键词。"},
            "path": {"type": "string", "description": "可选搜索路径。"},
            "pattern": {"type": "string", "description": "可选文件 glob。"},
            "limit": {"type": "integer", "description": "最大结果数，默认 80。"},
        },
        ["query"],
    ),
    _backend_tool_schema(
        "code_read",
        "读取明确的本地代码、notebook、配置或文本文件路径；.ipynb 会抽取源码、markdown 和纯文本输出。",
        {"path": {"type": "string", "description": "要读取的文件路径。"}},
        ["path"],
    ),
    _backend_tool_schema(
        "code_list",
        "检索本地 MIKI 项目目录或文件列表。",
        {
            "path": {"type": "string", "description": "目录路径，默认项目根目录。"},
            "pattern": {"type": "string", "description": "可选文件 glob。"},
            "recursive": {"type": "boolean", "description": "是否递归。"},
            "limit": {"type": "integer", "description": "最大条目数，默认 160。"},
        },
    ),
    _backend_tool_schema(
        "config_context",
        "读取当前训练配置。用户要求修改或检查训练 config 参数时使用。",
    ),
    _backend_tool_schema(
        "memory_retrieve",
        "检索长期记忆。用户要求回忆、查长期记忆、之前说过的项目或想法时使用。",
        {
            "query": {"type": "string", "description": "记忆检索 query。"},
            "limit": {"type": "integer", "description": "最大结果数，默认 24。"},
        },
        ["query"],
    ),
]


def _decode_tool_arguments(raw_arguments: Any) -> dict[str, Any]:
    if isinstance(raw_arguments, dict):
        return raw_arguments
    if not raw_arguments:
        return {}
    try:
        parsed = json.loads(str(raw_arguments))
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _chat_tool_call_to_message_tool_call(tool_call: Any) -> dict[str, Any]:
    function = getattr(tool_call, "function", None)
    return {
        "id": getattr(tool_call, "id", ""),
        "type": getattr(tool_call, "type", "function"),
        "function": {
            "name": getattr(function, "name", ""),
            "arguments": getattr(function, "arguments", "{}"),
        },
    }


def _chat_assistant_tool_message(message: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "role": "assistant",
        "content": message.content or "",
        "tool_calls": [
            _chat_tool_call_to_message_tool_call(tool_call)
            for tool_call in (message.tool_calls or [])
        ],
    }

    reasoning_content = getattr(message, "reasoning_content", None)
    if reasoning_content:
        payload["reasoning_content"] = reasoning_content

    return payload


def _coerce_tool_result(result: Any) -> dict[str, Any]:
    if isinstance(result, tuple) and len(result) == 2:
        body, status_code = result
        if isinstance(body, dict):
            return {**body, "http_status": status_code}
        return {"ok": False, "http_status": status_code, "result": body}
    if isinstance(result, dict):
        return result
    return {"ok": True, "result": result}


def _json_tool_content(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


def _execute_backend_chat_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    if name == "web_search":
        payload = {
            "query": arguments.get("query"),
            "limit": arguments.get("limit") or 5,
            "summarize": True,
        }
        return web_search_payload(payload)

    if name == "read_document":
        payload = {
            "url": arguments.get("url") or "",
            "arxiv_id": arguments.get("arxiv_id") or "",
            "task": arguments.get("task") or DEFAULT_PAPER_TASK_FOR_CHAT_TOOL,
        }
        return summarize_paper_payload(payload)

    if name == "code_search":
        return _coerce_tool_result(search_code_payload(arguments))

    if name == "code_read":
        return _coerce_tool_result(read_code_file_payload(arguments))

    if name == "code_list":
        return _coerce_tool_result(list_code_files_payload(arguments))

    if name == "config_context":
        return _coerce_tool_result(read_train_config())

    if name == "memory_retrieve":
        query = str(arguments.get("query") or "").strip()
        limit = int(arguments.get("limit") or MAX_MEMORY_RETRIEVE_TOOL_ITEMS)
        return get_long_term_memory_retrieval_payload(query, limit=limit)

    return {
        "ok": False,
        "error": f"unknown backend chat tool: {name}",
    }


DEFAULT_PAPER_TASK_FOR_CHAT_TOOL = (
    "请结合用户问题阅读材料。输出可用于回答用户的关键信息、来源、限制和后续建议。"
)


def _tool_status_line(
    name: str,
    phase: str,
    message: str,
    *,
    duration_ms: int | None = None,
) -> str:
    status = {
        "tool": name,
        "phase": phase,
        "message": message,
    }
    if duration_ms is not None:
        status["duration_ms"] = duration_ms

    return json.dumps(
        {"tool_status": status},
        ensure_ascii=False,
    ) + "\n"


def _references_line(references: list[dict[str, Any]]) -> str:
    return json.dumps({"references": references}, ensure_ascii=False) + "\n"


def _extract_tool_references(name: str, result: dict[str, Any]) -> list[dict[str, Any]]:
    if name == "web_search":
        return [
            {
                "title": item.get("title"),
                "source": item.get("url"),
                "url": item.get("url"),
            }
            for item in result.get("results", [])
            if isinstance(item, dict) and item.get("url")
        ]

    if name == "read_document":
        source = result.get("source") if isinstance(result, dict) else None
        if not isinstance(source, dict):
            return []
        url = source.get("url") or source.get("cache", {}).get("url") or ""
        return [
            {
                "title": source.get("name") or url or "document",
                "source": url or source.get("name") or "document",
                "url": url,
            }
        ]

    return []


TOOL_STATUS_COPY: dict[str, dict[str, str]] = {
    "web_search": {
        "running": "正在查找资料",
        "done": "资料查找完成",
        "error": "资料查找失败",
    },
    "read_document": {
        "running": "正在阅读文献",
        "done": "文献阅读完成",
        "error": "文献阅读失败",
    },
    "code_search": {
        "running": "正在检索代码",
        "done": "代码检索完成",
        "error": "代码检索失败",
    },
    "code_read": {
        "running": "正在阅读代码",
        "done": "代码阅读完成",
        "error": "代码阅读失败",
    },
    "code_list": {
        "running": "正在查看项目文件",
        "done": "项目文件已读完",
        "error": "项目文件读取失败",
    },
    "config_context": {
        "running": "正在查看训练配置",
        "done": "训练配置已读取",
        "error": "训练配置读取失败",
    },
    "memory_retrieve": {
        "running": "正在回忆相关内容",
        "done": "回忆完成",
        "error": "忘掉了……",
    },
}


def _tool_status_message(name: str, phase: str, fallback: str = "") -> str:
    return TOOL_STATUS_COPY.get(name, {}).get(phase) or fallback or "正在处理"


def _run_backend_tool_loop(
    *,
    messages: list[dict[str, Any]],
    model_name: str,
    max_completion_tokens: int,
) -> Generator[str, None, tuple[list[dict[str, Any]], str]]:
    tool_call_count = 0

    while tool_call_count < MAX_BACKEND_TOOL_CALLS_PER_TURN:
        response = get_llm_client().chat.completions.create(
            model=model_name,
            messages=messages,
            tools=BACKEND_CHAT_TOOLS,
            tool_choice="auto",
            temperature=0.7,
            max_tokens=max_completion_tokens,
            stream=False,
        )

        message = response.choices[0].message
        tool_calls = list(message.tool_calls or [])

        if not tool_calls:
            final_content = message.content or ""
            messages.append({
                "role": "assistant",
                "content": final_content,
            })
            return messages, final_content

        messages.append(_chat_assistant_tool_message(message))

        for tool_call in tool_calls:
            if tool_call_count >= MAX_BACKEND_TOOL_CALLS_PER_TURN:
                break

            function = getattr(tool_call, "function", None)
            name = str(getattr(function, "name", "") or "").strip()
            arguments = _decode_tool_arguments(getattr(function, "arguments", "{}"))
            tool_call_count += 1

            started_at = time.perf_counter()
            yield _tool_status_line(
                name,
                "running",
                _tool_status_message(name, "running"),
            )

            try:
                result = _execute_backend_chat_tool(name, arguments)
                phase = "done" if result.get("ok", True) is not False else "error"
                message_text = _tool_status_message(
                    name,
                    phase,
                    result.get("error", "处理失败"),
                )
            except Exception as exc:
                result = {
                    "ok": False,
                    "error": str(exc),
                }
                phase = "error"
                message_text = _tool_status_message(name, phase, str(exc))

            duration_ms = int((time.perf_counter() - started_at) * 1000)
            yield _tool_status_line(name, phase, message_text, duration_ms=duration_ms)

            references = _extract_tool_references(name, result)
            if references:
                yield _references_line(references)

            messages.append({
                "role": "tool",
                "tool_call_id": getattr(tool_call, "id", ""),
                "content": _json_tool_content(result),
            })

    messages.append({
        "role": "user",
        "content": "工具调用次数已达到上限。请基于已经获得的工具结果回答用户；如果信息不足，请明确说明。",
    })
    return messages, ""


def create_chat_stream_response(
    data: dict[str, Any],
) -> Generator[str, None, None] | tuple[dict[str, Any], int]:
    user_message = data.get("message", "").strip()
    display_user_message = str(data.get("display_message") or user_message).strip()
    session_id = str(data.get("session_id") or "").strip() or None
    message_type = str(data.get("message_type") or "user").strip()
    if message_type not in {"user", "interaction"}:
        message_type = "user"

    if not user_message:
        return error_payload("empty message"), 400

    messages, debug_retrieval = build_chat_messages(
        user_message,
        session_id=session_id,
        message_type=message_type,
    )
    max_completion_tokens = choose_max_completion_tokens(
        user_message,
        message_type=message_type,
    )
    model_name = choose_chat_model(
        user_message,
        message_type=message_type,
    )

    def generate() -> Generator[str, None, None]:
        full_reply = ""

        try:
            yield json.dumps(
                {"debug_retrieval": debug_retrieval},
                ensure_ascii=False,
            ) + "\n"
            yield json.dumps(
                {
                    "model_info": {
                        "model": model_name,
                        "mode": get_chat_model_mode(model_name),
                        "thinking_motion": model_name == OPENAI_THINKING_MODEL,
                    }
                },
                ensure_ascii=False,
            ) + "\n"

            loop = _run_backend_tool_loop(
                messages=messages,
                model_name=model_name,
                max_completion_tokens=max_completion_tokens,
            )
            try:
                while True:
                    yield next(loop)
            except StopIteration as stop:
                _messages_after_tools, final_content = stop.value or (messages, "")

            if final_content:
                full_reply = final_content
                yield json.dumps({"token": final_content}, ensure_ascii=False) + "\n"
            else:
                stream = get_llm_client().chat.completions.create(
                    model=model_name,
                    messages=_messages_after_tools,
                    temperature=0.7,
                    max_tokens=max_completion_tokens,
                    stream=True,
                )

                for chunk in stream:
                    if not chunk.choices:
                        continue

                    delta = chunk.choices[0].delta
                    token = getattr(delta, "content", None)

                    if token is None:
                        continue

                    full_reply += token
                    yield json.dumps({"token": token}, ensure_ascii=False) + "\n"

            append_message(
                "user",
                display_user_message,
                session_id=session_id,
                message_type=message_type,
            )
            append_message(
                "assistant",
                _strip_hidden_control_text(full_reply),
                session_id=session_id,
            )

        except Exception as e:
            print("LLM stream runtime error:", e, flush=True)
            yield json.dumps(
                {"error": f"stream runtime failed: {str(e)}"},
                ensure_ascii=False,
            ) + "\n"

    return generate()
