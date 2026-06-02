function formatListResult(result) {
  const items = Array.isArray(result?.items) ? result.items : [];
  return items
    .slice(0, 80)
    .map((item) => `- [${item.type}] ${item.path}${item.size != null ? ` (${item.size} bytes)` : ""}`)
    .join("\n");
}

function formatSearchResult(result) {
  const items = Array.isArray(result?.results) ? result.results : [];
  return items
    .slice(0, 80)
    .map((item) => `- ${item.path}:${item.line} ${item.text}`)
    .join("\n");
}

function formatReadResult(result) {
  const content = String(result?.content || "");
  const clipped = content.length > 18000
    ? `${content.slice(0, 18000)}\n...<truncated>`
    : content;

  return `文件：${result?.path || "unknown"}\n大小：${result?.size ?? "unknown"} bytes\n\n\`\`\`\n${clipped}\n\`\`\``;
}

export function buildCodeAgentContext({ mode, result }) {
  if (!result) return "";

  if (mode === "list") {
    return `
[代码目录检索结果]
根目录：${result.root || ""}
路径：${result.path || "."}
模式：${result.pattern || "*"}
结果：
${formatListResult(result)}
`.trim();
  }

  if (mode === "search") {
    return `
[代码搜索结果]
搜索词：${result.query || ""}
路径：${result.path || "."}
模式：${result.pattern || "*"}
结果：
${formatSearchResult(result)}
`.trim();
  }

  if (mode === "read") {
    return `
[代码阅读结果]
${formatReadResult(result)}
`.trim();
  }

  return "";
}

export function buildCodeAgentPrompt({ userText = "", codeContext = "" } = {}) {
  if (!codeContext) return userText;

  return `
用户原始问题：
${userText}

下面是代码 agent 已经读取到的只读代码上下文。请基于这些结果回答；如果上下文不足，明确说明还需要继续检索哪个文件或关键词。

${codeContext}
`.trim();
}
