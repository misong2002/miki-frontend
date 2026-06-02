from __future__ import annotations

import json
import os
import re
from typing import Any

from config import OPENAI_FAST_MODEL
from services.llm_service import get_llm_client
from services.response_service import success_payload


MAX_TOOL_CALLS = int(os.getenv("MIKI_TOOL_ROUTER_MAX_CALLS", "4"))
MAX_RECENT_CONTEXT_MESSAGES = 16
MAX_RECENT_CONTEXT_CHARS = 3600


def _router_model() -> str:
    return os.getenv("MIKI_TOOL_ROUTER_MODEL") or OPENAI_FAST_MODEL


def _format_recent_context(messages: Any) -> str:
    if not isinstance(messages, list):
        return "无"

    lines: list[str] = []
    used = 0

    for msg in messages[-MAX_RECENT_CONTEXT_MESSAGES:]:
        if not isinstance(msg, dict):
            continue
        role = str(msg.get("role") or "").strip()
        if role not in {"user", "assistant"}:
            continue
        content = re.sub(r"\s+", " ", str(msg.get("content") or "")).strip()
        if not content:
            continue
        line = f"{role}: {content[:360]}"
        if used + len(line) > MAX_RECENT_CONTEXT_CHARS:
            break
        lines.append(line)
        used += len(line)

    return "\n".join(lines) if lines else "无"


def _tool_schema(
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


TOOL_DEFINITIONS: list[dict[str, Any]] = [
    _tool_schema(
        "read_document",
        "读取用户上传的附件。只有 payload 表明存在上传附件时才使用；URL/arXiv 文档由后端聊天 tool loop 处理。",
    ),
    _tool_schema(
        "transform_model",
        "切换 Live2D 模型形态。用户要求变身、魔法少女形态、解除变身或回普通形态时使用。",
        {
            "target_model": {
                "type": "string",
                "enum": ["magical", "normal"],
                "description": "目标形态。",
            }
        },
        ["target_model"],
    ),
    _tool_schema(
        "start_training",
        "启动训练。用户明确要求开始训练、开跑、开始 battle 或进入训练战斗时使用。这是前端态动作工具。",
    ),
    _tool_schema(
        "moving",
        "调整 Live2D 模型舞台位置、远近或大小。这是前端态动作工具。",
        {
            "dx": {"type": "number", "description": "相对横向位移，左负右正。"},
            "dy": {"type": "number", "description": "相对纵向位移，上负下正。"},
            "scale_delta": {"type": "number", "description": "相对缩放变化。"},
            "target_x": {"type": "number", "description": "绝对横向位置。"},
            "target_y": {"type": "number", "description": "绝对纵向位置。"},
            "target_scale": {"type": "number", "description": "绝对缩放。"},
            "duration_ms": {"type": "integer", "description": "动画时长，默认 650。"},
        },
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


def _standard_tool_call_to_dict(tool_call: Any) -> dict[str, Any] | None:
    function = getattr(tool_call, "function", None)
    name = getattr(function, "name", None)
    if not name:
        return None

    raw_arguments = getattr(function, "arguments", "{}")
    return {
        "id": getattr(tool_call, "id", None),
        "type": getattr(tool_call, "type", "function"),
        "function": {
            "name": name,
            "arguments": raw_arguments,
        },
    }


def _simplify_standard_tool_call(tool_call: dict[str, Any]) -> dict[str, Any] | None:
    function = tool_call.get("function") if isinstance(tool_call, dict) else None
    if not isinstance(function, dict):
        return None
    name = str(function.get("name") or "").strip()
    if not name:
        return None
    arguments = _decode_tool_arguments(function.get("arguments"))
    return {"name": name, **arguments}


def _attachment_tool_call() -> dict[str, Any]:
    return {
        "id": "forced_read_document",
        "type": "function",
        "function": {
            "name": "read_document",
            "arguments": "{}",
        },
    }


def route_tools_payload(payload: dict[str, Any]) -> tuple[dict[str, Any], int]:
    user_text = str(payload.get("message") or payload.get("text") or "").strip()
    has_attachment = bool(payload.get("has_attachment"))
    attachment_name = str(payload.get("attachment_name") or "").strip()
    recent_context = _format_recent_context(payload.get("recent_messages"))

    if not user_text and not has_attachment:
        return success_payload(status="done", raw_text="", tool_calls=[], standard_tool_calls=[]), 200

    prompt = f"""
你是 MIKI 的工具路由器。你的任务不是回答用户，而是判断是否需要调用工具。
如果需要工具，你可以给一句非常短的可见开场白，让用户知道你要做什么。

路由规则：
- 通过 API 提供的 tools 调用工具，不要输出自定义 JSON 控制符。
- 最多调用 {MAX_TOOL_CALLS} 个工具。
- 如果需要可见开场白，把一句短开场白放在 assistant content 中。
- 开场白必须短，像 Sayaka 对朋友自然说话，不要系统腔，不要超过 25 个汉字。
- 不要给最终答案。
- 本路由器只处理前端态工具：上传附件读取、Live2D 形态切换、训练启动、模型站位移动。
- 网页搜索、URL/arXiv 文档读取、代码搜索/读取/列表、训练配置读取、长期记忆检索都由 /api/chat 内部的后端标准 tool loop 处理；本路由器不要为这些场景调用工具。
- 如果有上传附件，通常使用 read_document；如果只是 URL/arXiv 文档而没有上传文件，不要使用 read_document。
- 如果用户说“变身”“切换魔法少女形态”“进入战斗形态”“换成魔法少女模型”，使用 transform_model，target_model 设为 magical。
- 如果用户说“解除变身”“回到普通形态”“换回普通模型”，使用 transform_model，target_model 设为 normal。
- 如果用户说“开始训练吧”“开跑”“开始 battle”“开始训练”“进入训练战斗”，使用 start_training。
- 如果用户只是询问如何训练、解释训练流程、检查训练参数，不要使用 start_training。
- 如果用户说“往左/右靠一点”“站中间一点”“上/下去一点”“离镜头近一点/远一点”“放大/缩小一点”“能不能靠近点”这类舞台位置或远近请求，使用 moving。
- moving 的幅度要保守：一点/稍微通常 dx 或 dy 用 0.04 到 0.08，明显移动用 0.10 到 0.16；近一点通常 scale_delta 用 0.10 到 0.18，远一点用 -0.10 到 -0.18。目标要尽量让模型仍然可见；除非用户明确要求大特写，不要让 target_scale 超过 1.25。
- 如果用户明确说“回到原位”“回默认位置”“站回默认位置”，使用 moving 并设为 {{"target_x":0.5,"target_y":1.0,"target_scale":1.0}}；不要因此切换服装。
- 如果不需要工具，不要调用工具，assistant content 留空或写“无需工具”。

最近对话上下文：
{recent_context}

用户消息：
{user_text}

附件：{attachment_name if has_attachment else "无"}
""".strip()

    response = get_llm_client().chat.completions.create(
        model=_router_model(),
        messages=[
            {
                "role": "system",
                "content": "你是严格的工具路由器，只能通过 tools 选择工具，不回答用户问题。",
            },
            {
                "role": "user",
                "content": prompt,
            },
        ],
        tools=TOOL_DEFINITIONS,
        tool_choice="auto",
        temperature=0.0,
        max_tokens=1800,
        stream=False,
    )

    message = response.choices[0].message
    raw_text = message.content or ""
    prelude = re.sub(r"\s+", " ", raw_text).strip()
    if prelude == "无需工具":
        prelude = ""

    standard_tool_calls = [
        item
        for item in (
            _standard_tool_call_to_dict(tool_call)
            for tool_call in (message.tool_calls or [])
        )
        if item is not None
    ][:MAX_TOOL_CALLS]

    tool_calls = [
        item
        for item in (_simplify_standard_tool_call(tool_call) for tool_call in standard_tool_calls)
        if item is not None
    ]

    if has_attachment and not any(call.get("name") == "read_document" for call in tool_calls):
        forced_call = _attachment_tool_call()
        standard_tool_calls.insert(0, forced_call)
        tool_calls.insert(0, {"name": "read_document"})
        prelude = prelude or "我先读一下这个附件。"

    return success_payload(
        status="done",
        raw_text=raw_text,
        prelude=prelude,
        tool_calls=tool_calls[:MAX_TOOL_CALLS],
        standard_tool_calls=standard_tool_calls[:MAX_TOOL_CALLS],
    ), 200
