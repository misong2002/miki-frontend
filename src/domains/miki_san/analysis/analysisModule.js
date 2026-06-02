import { readDocument, webSearch } from "./analysisService";
import {
  detectArxivId,
  detectDocumentUrl,
  detectWebSearchIntent,
} from "./analysisTriggers";
import { buildAugmentedAnalysisPrompt } from "./analysisPrompt";

function createDocumentTask(userText = "") {
  const trimmed = String(userText || "").trim();
  if (!trimmed) {
    return "请阅读这个上传文档，给出中文摘要、关键贡献、证据、局限性和后续建议。";
  }

  return `请结合用户问题阅读文档。用户问题：${trimmed}`;
}

export async function prepareAnalysisContext({
  text = "",
  attachment = null,
  searchLimit = 5,
  onToolStatus = null,
} = {}) {
  const arxivId = detectArxivId(text);
  const documentUrl = detectDocumentUrl(text);
  const searchIntent = detectWebSearchIntent(text);
  const tasks = [];

  function emitToolStatus(status) {
    if (typeof onToolStatus === "function") {
      onToolStatus({
        at: Date.now(),
        ...status,
      });
    }
  }

  if (attachment?.file || arxivId || documentUrl) {
    const sourceLabel =
      attachment?.file?.name ||
      (arxivId ? `arXiv:${arxivId}` : documentUrl);
    emitToolStatus({
      tool: "read-document",
      phase: "running",
      message: `正在解析文件：${sourceLabel}`,
    });

    tasks.push(
      readDocument({
        file: attachment?.file ?? null,
        url: documentUrl,
        arxivId,
        task: createDocumentTask(text),
      }).then((result) => ({
        type: "document",
        result,
        sourceLabel,
      }))
    );
  }

  if (searchIntent.shouldSearch) {
    emitToolStatus({
      tool: "web-search",
      phase: "running",
      message: `正在网页搜索：${searchIntent.query}`,
    });

    tasks.push(
      webSearch({
        query: searchIntent.query,
        limit: searchLimit,
        summarize: true,
      }).then((result) => ({
        type: "search",
        result,
        sourceLabel: searchIntent.query,
      }))
    );
  }

  if (tasks.length === 0) {
    return {
      promptText: text,
      documentResult: null,
      searchResult: null,
      references: [],
      usedTools: [],
    };
  }

  const settled = await Promise.allSettled(tasks);
  const failures = settled
    .filter((item) => item.status === "rejected")
    .map((item) => item.reason?.message || String(item.reason));

  if (failures.length) {
    emitToolStatus({
      tool: "analysis",
      phase: "error",
      message: failures.join("\n"),
    });
    throw new Error(failures.join("\n"));
  }

  const values = settled.map((item) => item.value);
  const documentResult =
    values.find((item) => item.type === "document")?.result ?? null;
  const searchResult = values.find((item) => item.type === "search")?.result ?? null;

  if (documentResult) {
    const source = documentResult.source ?? {};
    emitToolStatus({
      tool: "read-document",
      phase: "done",
      message: `文件解析完成：${source.name || source.url || "document"}`,
    });
  }

  if (searchResult) {
    emitToolStatus({
      tool: "web-search",
      phase: "done",
      message: `网页搜索完成：找到 ${(searchResult.results ?? []).length} 个结果`,
    });
  }

  const references = [
    ...(documentResult?.source
      ? [
          {
            title: documentResult.source.name || "document",
            source: documentResult.source.url || "document",
            url: documentResult.source.url || "",
          },
        ]
      : []),
    ...(searchResult?.results ?? []).map((item) => ({
      title: item.title,
      source: item.url,
      url: item.url,
    })),
  ];

  return {
    promptText: buildAugmentedAnalysisPrompt({
      userText: text,
      documentResult,
      searchResult,
    }),
    documentResult,
    searchResult,
    references,
    usedTools: values.map((item) => item.type),
  };
}
