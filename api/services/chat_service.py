import json
import re
from typing import Any, Generator

from config import OPENAI_MODEL, PROFILE_BUNDLE_MAX_FACTS
from memory.memory_store import get_long_term_db, list_idea_tag_catalog
from services.llm_service import get_llm_client
from services.memory_service import (
    append_message,
    get_recent_messages,
)
from services.persona_service import get_system_prompt
from services.response_service import error_payload


MAX_RETRIEVED_LONG_TERM_ITEMS = 6
MAX_RETRIEVAL_HISTORY_MESSAGES = 4
MAX_PROMPT_HISTORY_MESSAGES = 20
MAX_PROMPT_MESSAGE_CHARS = 10000
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
        for item in db.get("user_facts", [])
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
        for item in db.get("idea_memories", [])
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
        for item in db.get("user_facts", [])
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
    facts = db.get("user_facts", [])
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
    for project in db.get("project_states", []):
        selected.append(_make_selected_item("project", project, score=100.0, matched_fields=["project_bundle"]))

    for fact in db.get("user_facts", []):
        if fact.get("category") == "project_context":
            selected.append(_make_selected_item("fact", fact, score=90.0, matched_fields=["project_context"]))

    summaries = sorted(
        db.get("session_summaries", []),
        key=lambda item: item.get("updated_at", 0),
        reverse=True,
    )[:4]
    for summary in summaries:
        selected.append(_make_selected_item("summary", summary, score=80.0, matched_fields=["recent_summary"]))

    return selected[:12]


def _retrieve_session_bundle(db: dict[str, Any]) -> list[dict[str, Any]]:
    summaries = sorted(
        db.get("session_summaries", []),
        key=lambda item: item.get("updated_at", 0),
        reverse=True,
    )[:8]
    selected = [
        _make_selected_item("summary", summary, score=100.0, matched_fields=["recent_summary"])
        for summary in summaries
    ]
    return selected


def _retrieve_idea_catalog_bundle(db: dict[str, Any]) -> list[dict[str, Any]]:
    ideas = sorted(
        db.get("idea_memories", []),
        key=lambda item: (
            float(item.get("importance", 0.0)),
            float(item.get("novelty", 0.0)),
            item.get("updated_at", 0),
        ),
        reverse=True,
    )[:10]
    return [
        _make_selected_item("idea", idea, score=100.0, matched_fields=["idea_catalog"])
        for idea in ideas
    ]


def build_memory_context(query_text: str) -> dict[str, Any]:
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
        retrieved = retrieve_relevant_long_term_memories(query_text)

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
        ("fact", db.get("user_facts", [])),
        ("project", db.get("project_states", [])),
        ("idea", db.get("idea_memories", [])),
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
        "fact": 2,
        "project": 2,
        "idea": 2,
        "summary": 2,
        "digest": 1,
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
    context = build_memory_context(query_text)
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
) -> tuple[list[dict[str, str]], dict[str, Any]]:
    history = get_recent_messages(limit=12, session_id=session_id)
    retrieval_query = _build_retrieval_query(history, user_message)
    context = build_memory_context(retrieval_query)
    retrieved_memory_block = context["memory_block"]
    prompt_history = _build_prompt_history(history)

    messages = [
        {"role": "system", "content": get_system_prompt()}
    ]

    if retrieved_memory_block:
        messages.append({
            "role": "system",
            "content": f"（用户的问题让你想起了：\n{retrieved_memory_block}\n）",
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


def create_chat_stream_response(
    data: dict[str, Any],
) -> Generator[str, None, None] | tuple[dict[str, Any], int]:
    user_message = data.get("message", "").strip()
    session_id = str(data.get("session_id") or "").strip() or None

    if not user_message:
        return error_payload("empty message"), 400

    messages, debug_retrieval = build_chat_messages(
        user_message,
        session_id=session_id,
    )

    try:
        stream = get_llm_client().chat.completions.create(
            model=OPENAI_MODEL,
            messages=messages,
            temperature=0.7,
            max_tokens=8000,
            stream=True,
        )
    except Exception as e:
        print("LLM stream init error:", e, flush=True)
        return error_payload(f"LLM stream init failed: {e}"), 500

    def generate() -> Generator[str, None, None]:
        full_reply = ""

        try:
            yield json.dumps(
                {"debug_retrieval": debug_retrieval},
                ensure_ascii=False,
            ) + "\n"

            for chunk in stream:
                if not chunk.choices:
                    continue

                delta = chunk.choices[0].delta
                token = getattr(delta, "content", None)

                if token is None:
                    continue

                full_reply += token
                yield json.dumps({"token": token}, ensure_ascii=False) + "\n"

            append_message("user", user_message, session_id=session_id)
            append_message("assistant", full_reply, session_id=session_id)

        except Exception as e:
            print("LLM stream runtime error:", e, flush=True)
            yield json.dumps(
                {"error": f"stream runtime failed: {str(e)}"},
                ensure_ascii=False,
            ) + "\n"

    return generate()
