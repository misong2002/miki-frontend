function formatList(items = [], fallback = "无") {
  if (!Array.isArray(items) || items.length === 0) return fallback;
  return items.map((item) => `- ${item}`).join("\n");
}

function formatDocumentContext(documentResult) {
  if (!documentResult?.result) return "";

  const result = documentResult.result;
  const source = documentResult.source ?? {};

  return `
[附件/论文读取结果]
来源：${source.name || source.url || "uploaded document"}
截断：${source.truncated ? "是" : "否"}
摘要：${result.summary || ""}
问题：${result.problem || ""}
方法：${result.method || ""}
贡献：
${formatList(result.contributions)}
证据：
${formatList(result.evidence)}
局限：
${formatList(result.limitations)}
下一步：
${formatList(result.next_steps)}
术语：
${formatList(result.terms)}
`.trim();
}

function formatSearchContext(searchResult) {
  if (!searchResult?.results?.length) return "";

  const results = searchResult.results
    .map(
      (item, index) =>
        `${index + 1}. ${item.title}\nURL: ${item.url}\n摘要：${item.snippet || "无"}`
    )
    .join("\n\n");

  return `
[网页搜索结果]
搜索词：${searchResult.query || ""}
搜索源：${searchResult.provider || "unknown"}
整理摘要：${searchResult.summary || "未请求摘要"}
结果：
${results}
`.trim();
}

export function buildAugmentedAnalysisPrompt({
  userText = "",
  documentResult = null,
  searchResult = null,
} = {}) {
  const contexts = [
    formatDocumentContext(documentResult),
    formatSearchContext(searchResult),
  ].filter(Boolean);

  if (contexts.length === 0) return userText;

  return `
用户原始问题：
${userText}

以下是系统已经为你预先读取/搜索到的材料。回答时请优先基于这些材料；涉及网页搜索结果时要引用来源编号或 URL；材料不足时明确说明不确定。

${contexts.join("\n\n")}
`.trim();
}
