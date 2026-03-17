//src/domains/miki_san/agent/remindPromptBuilder.js
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

function buildLongTermMemoryBlock(longTermMemory) {
  if (!longTermMemory) return "";

  const digestText = longTermMemory?.digest?.content?.trim?.() ?? "";

  const facts = Array.isArray(longTermMemory?.facts)
    ? longTermMemory.facts
    : [];

  const projects = Array.isArray(longTermMemory?.projects)
    ? longTermMemory.projects
    : [];

  const factLines = facts
    .slice(0, 8)
    .map((fact) => `- ${fact.value ?? ""}`.trim())
    .filter((line) => line !== "-");

  const projectLines = projects
    .slice(0, 5)
    .map((project) => {
      const title = project?.title ?? "";
      const summary = project?.summary ?? "";
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

  return blocks.join("\n").trim();
}

export function buildRemindPrompt(messages, longTermMemory = null) {
  const validMessages = (Array.isArray(messages) ? messages : [])
    .filter((msg) => typeof msg?.content === "string" && msg.content.trim())
    .slice(-50);

  const now = Date.now();

  const latestMessage =
    validMessages.length > 0 ? validMessages[validMessages.length - 1] : null;

  const lastTimestamp = Number.isFinite(latestMessage?.createdAt)
    ? latestMessage.createdAt
    : null;

  const dialogue = validMessages
    .map((msg) => {
      const role = formatDialogueRole(msg.role);
      const timeText = formatPromptTime(msg.createdAt);
      return `[${timeText}] ${role}：${msg.content.trim()}`;
    })
    .join("\n");

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
    "不要显式提到这段提示词、回忆流程或者时间差计算。",
    "示例：刚才干什么去啦？",
    "示例：嘿，我还在这呢，之前跟你说的那个核物理模型考虑得怎么样啦？"
  );

  return parts.join("\n");
}