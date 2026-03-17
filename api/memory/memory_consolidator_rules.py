# api/memory/memory_consolidator_rules.py

from __future__ import annotations

from typing import Any, Dict, List, Optional


def _clean_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    cleaned = []
    for msg in messages or []:
        content = (msg.get("content") or "").strip()
        if not content:
            continue
        cleaned.append(
            {
                "id": msg.get("id"),
                "role": msg.get("role", "unknown"),
                "content": content,
                "created_at": msg.get("createdAt") or msg.get("created_at"),
                "wake_cycle_id": msg.get("wakeCycleId") or msg.get("wake_cycle_id"),
            }
        )
    return cleaned


def _extract_topics(messages: List[Dict[str, Any]]) -> List[str]:
    joined = "\n".join(msg["content"] for msg in messages).lower()
    topics = []

    keyword_map = {
        "wake cycle": ["wake cycle", "wakecycle"],
        "memory": ["memory", "记忆", "长期记忆", "短期记忆"],
        "system prompt": ["system prompt", "prompt"],
        "hyperk": ["hyperk", "hyper-k"],
        "bsm": ["bsm"],
        "machine learning": ["machine learning", "ml", "机器学习"],
        "physics": ["物理", "physics", "ads/qcd", "qcd", "量子引力"],
        "ui": ["ui", "chatpanel", "app.jsx", "前端"],
    }

    for topic, keywords in keyword_map.items():
        if any(k in joined for k in keywords):
            topics.append(topic)

    return topics


def _extract_open_loops(messages: List[Dict[str, Any]]) -> List[str]:
    open_loops = []
    last_texts = [msg["content"] for msg in messages[-16:]]

    for text in last_texts:
        if "接下来" in text or "下一步" in text or "还要" in text or "TODO" in text:
            open_loops.append(text[:160])

    return open_loops[:8]


def _extract_resolved_items(messages: List[Dict[str, Any]]) -> List[str]:
    resolved = []
    for text in [msg["content"] for msg in messages[-24:]]:
        if any(k in text for k in ["成功", "修好了", "搞定了", "没问题了", "非常成功"]):
            resolved.append(text[:160])
    return resolved[:8]


def _build_summary(messages: List[Dict[str, Any]], topics: List[str]) -> str:
    if not messages:
        return ""

    recent_user_msgs = [m["content"] for m in messages if m["role"] == "user"][-4:]
    recent_assistant_msgs = [m["content"] for m in messages if m["role"] == "assistant"][-4:]

    parts = []

    if topics:
        parts.append(f"本段对话主要涉及：{', '.join(topics)}。")

    if recent_user_msgs:
        parts.append(f"用户近期主要在推进或讨论：{'；'.join(recent_user_msgs[:3])}")

    if recent_assistant_msgs:
        parts.append(f"助手最近的回应重点是：{'；'.join(recent_assistant_msgs[:2])}")

    return " ".join(parts).strip()


def _extract_user_facts(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    facts: List[Dict[str, Any]] = []
    user_text = "\n".join(m["content"] for m in messages if m["role"] == "user")
    lowered = user_text.lower()

    if "hyperk" in lowered or "hyper-k" in lowered:
        facts.append(
            {
                "key": "research_focus_hyperk",
                "value": "长期关注 HyperK 相关研究内容",
                "category": "research_interest",
                "confidence": 0.95,
                "pinned": True,
            }
        )

    if "bsm" in lowered:
        facts.append(
            {
                "key": "research_focus_bsm",
                "value": "长期关注 BSM 物理问题",
                "category": "research_interest",
                "confidence": 0.95,
                "pinned": True,
            }
        )

    if "机器学习" in user_text or "machine learning" in lowered or " ml " in f" {lowered} ":
        facts.append(
            {
                "key": "research_focus_ml",
                "value": "持续关注机器学习及其与物理建模的结合",
                "category": "research_interest",
                "confidence": 0.88,
                "pinned": False,
            }
        )

    if "量子引力" in user_text or "quantum gravity" in lowered:
        facts.append(
            {
                "key": "research_focus_qg",
                "value": "持续关注量子引力相关问题",
                "category": "research_interest",
                "confidence": 0.9,
                "pinned": False,
            }
        )

    return facts


def _extract_ideas(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    ideas: List[Dict[str, Any]] = []
    user_messages = [m["content"] for m in messages if m["role"] == "user"]

    for text in user_messages:
        lowered = text.lower()

        if "ads/qcd" in lowered or "adsqcd" in lowered:
            ideas.append(
                {
                    "title": "用 AdS/QCD 框架启发机器学习建模",
                    "content": text,
                    "category": "physics_ml_idea",
                    "status": "open",
                    "novelty": 0.9,
                    "importance": 0.9,
                    "tags": ["AdS/QCD", "machine learning", "physics"],
                    "open_questions": [
                        "理论结构如何映射为可训练模型",
                        "物理可解释性与工程可行性如何兼顾",
                    ],
                }
            )
        elif any(k in text for k in ["有没有可能", "能不能", "是否可以", "我在想"]):
            ideas.append(
                {
                    "title": text[:48],
                    "content": text,
                    "category": "general_open_idea",
                    "status": "open",
                    "novelty": 0.75,
                    "importance": 0.75,
                    "tags": [],
                    "open_questions": [],
                }
            )

    return ideas[:12]


def _extract_project_updates(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    joined = "\n".join(m["content"] for m in messages)
    updates: List[Dict[str, Any]] = []

    if "MIKI" in joined or "memory system" in joined.lower() or "长期记忆" in joined:
        updates.append(
            {
                "project_key": "miki_memory_system",
                "title": "MIKI memory system",
                "status": "active",
                "summary": "正在推进 MIKI 的长期记忆与记忆归档结构设计。",
                "recent_changes": [],
                "next_steps": [
                    "实现长期记忆后端存储",
                    "实现 archive API",
                    "实现 digest 重建",
                ],
            }
        )

    return updates


def consolidate_memory_with_rules(
    messages: List[Dict[str, Any]],
    observations: Optional[List[Dict[str, Any]]] = None,
    training_runs: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    cleaned_messages = _clean_messages(messages)

    if not cleaned_messages:
        return {
            "summary": {
                "summary": "",
                "topics": [],
                "open_loops": [],
                "resolved_items": [],
            },
            "facts": [],
            "ideas": [],
            "project_updates": [],
        }

    topics = _extract_topics(cleaned_messages)
    open_loops = _extract_open_loops(cleaned_messages)
    resolved_items = _extract_resolved_items(cleaned_messages)
    summary_text = _build_summary(cleaned_messages, topics)

    facts = _extract_user_facts(cleaned_messages)
    ideas = _extract_ideas(cleaned_messages)
    project_updates = _extract_project_updates(cleaned_messages)

    return {
        "summary": {
            "summary": summary_text,
            "topics": topics,
            "open_loops": open_loops,
            "resolved_items": resolved_items,
        },
        "facts": facts,
        "ideas": ideas,
        "project_updates": project_updates,
    }