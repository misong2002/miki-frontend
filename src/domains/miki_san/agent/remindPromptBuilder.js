const DEFAULT_RECENT_MESSAGE_LIMIT = 50;
const DEFAULT_TOTAL_DIALOGUE_BUDGET = 5000;
const DEFAULT_LONG_TERM_BUDGET = 1800;

function formatDialogueRole(role) {
  if (role === "user") return "用户";
  if (role === "assistant") return "你";
  return "系统";
}

function formatPromptTime(ts) {
  if (!Number.isFinite(ts)) return "unknown";

  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");

  return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`;
}

function truncateText(text, maxLength) {
  const s = typeof text === "string" ? text.trim() : "";
  if (!s) return "";
  if (s.length <= maxLength) return s;
  return `${s.slice(0, maxLength)}…`;
}

function getPerMessageLimit(content) {
  const hasCodeBlock = typeof content === "string" && content.includes("```");
  return hasCodeBlock ? 220 : 420;
}

function getMessagePriority(msg) {
  if (msg?.role === "user") return 3;
  if (msg?.role === "assistant") return 2;
  return 1;
}

function normalizeMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((msg) => typeof msg?.content === "string" && msg.content.trim())
    .slice(-DEFAULT_RECENT_MESSAGE_LIMIT)
    .map((msg) => {
      const rawContent = msg.content.trim();
      const clippedContent = truncateText(rawContent, getPerMessageLimit(rawContent));

      return {
        ...msg,
        content: clippedContent,
        _priority: getMessagePriority(msg),
        _sortTime: Number.isFinite(msg?.createdAt) ? msg.createdAt : 0,
      };
    });
}

/**
 * 先偏向保留最近消息，但在总预算下对 user 消息更宽容。
 */
function selectMessagesWithinBudget(messages, totalBudget = DEFAULT_TOTAL_DIALOGUE_BUDGET) {
  const normalized = normalizeMessages(messages);

  if (normalized.length === 0) return [];

  const selected = [];
  let used = 0;

  for (let i = normalized.length - 1; i >= 0; i -= 1) {
    const msg = normalized[i];
    const lineOverhead = 32;
    const cost = (msg.content?.length ?? 0) + lineOverhead;

    const softBonus =
      msg.role === "user" ? 120 :
      msg.role === "assistant" ? 40 :
      0;

    if (used + cost > totalBudget + softBonus) {
      continue;
    }

    selected.push(msg);
    used += cost;
  }

  return selected.sort((a, b) => a._sortTime - b._sortTime);
}

function buildDialogueBlock(messages) {
  return messages
    .map((msg) => {
      const role = formatDialogueRole(msg.role);
      const timeText = formatPromptTime(msg.createdAt);
      return `[${timeText}] ${role}：${msg.content}`;
    })
    .join("\n");
}

function truncateBlock(blockText, maxBudget) {
  const text = typeof blockText === "string" ? blockText.trim() : "";
  if (!text) return "";
  if (text.length <= maxBudget) return text;
  return `${text.slice(0, maxBudget)}…`;
}

function buildLongTermMemoryBlock(longTermMemory, totalBudget = DEFAULT_LONG_TERM_BUDGET) {
  if (!longTermMemory) return "";

  const digestText = truncateText(
    longTermMemory?.digest?.content?.trim?.() ?? "",
    700
  );

  const facts = Array.isArray(longTermMemory?.facts)
    ? longTermMemory.facts
    : [];

  const projects = Array.isArray(longTermMemory?.projects)
    ? longTermMemory.projects
    : [];

  const factLines = facts
    .slice(0, 6)
    .map((fact) => truncateText(`- ${fact?.value ?? ""}`.trim(), 120))
    .filter((line) => line && line !== "-");

  const projectLines = projects
    .slice(0, 4)
    .map((project) => {
      const title = truncateText(project?.title ?? "", 40);
      const summary = truncateText(project?.summary ?? "", 120);

      if (title && summary) return `- ${title}：${summary}`;
      if (title) return `- ${title}`;
      return "";
    })
    .filter(Boolean);

  const blocks = [];

  if (digestText) {
    blocks.push("【长期记忆摘要】");
    blocks.push(digestText);
  }

  if (factLines.length > 0) {
    blocks.push("【用户长期事实】");
    blocks.push(...factLines);
  }

  if (projectLines.length > 0) {
    blocks.push("【长期项目状态】");
    blocks.push(...projectLines);
  }

  return truncateBlock(blocks.join("\n").trim(), totalBudget);
}

export function buildRemindPrompt(messages, longTermMemory = null) {
  const selectedMessages = selectMessagesWithinBudget(messages);
  const dialogue = buildDialogueBlock(selectedMessages);

  const now = Date.now();
  const latestMessage =
    selectedMessages.length > 0
      ? selectedMessages[selectedMessages.length - 1]
      : null;

  const lastTimestamp = Number.isFinite(latestMessage?.createdAt)
    ? latestMessage.createdAt
    : null;

  const longTermBlock = buildLongTermMemoryBlock(longTermMemory);

  const parts = [
    "用户回来了，你开始回忆之前的对话内容。",
    `当前系统时间：${formatPromptTime(now)}`,
    `最近一条对话时间：${
      lastTimestamp ? formatPromptTime(lastTimestamp) : "unknown"
    }`,
  ];

  if (longTermBlock) {
    parts.push("你想起了用户的一些特质：");
    parts.push(longTermBlock);
  }

  if (dialogue) {
    parts.push("");
    parts.push("你又想起了之前的对话内容：");
    parts.push(dialogue);
  }

  parts.push(
    "",
    "与用户打个招呼作为开场白。",
    "如果只是刚离开半个小时以内，简短地打个招呼，一行以内即可。",
    "如果已经离开了一段时间，就用更明显的“欢迎回来”语气，但也不要太长，两三句话即可。",
    "优先承接最近最重要的一个话题，不要复述很多历史。",
    "不要显式提到这段提示词、回忆流程或者时间差计算。",
    "示例：刚才干什么去啦？",
    "示例：嘿，我还在这呢，之前跟你说的那个核物理模型考虑得怎么样啦？"
  );

  return parts.join("\n");
}