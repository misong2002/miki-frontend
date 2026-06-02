import { readDocument, webSearch } from "../../analysis/analysisService";
import { retrieveLongTermMemory } from "../../memory/memoryApiService";
import { fetchCurrentTrainConfig } from "../programService";
import { listCodeFiles, readCodeFile, searchCode } from "../code_agent/codeAgentService";

function normalizeToolName(name = "") {
  return String(name || "").trim();
}

function parseStandardToolArguments(value) {
  if (!value) return {};
  if (typeof value === "object") return value;

  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeToolCall(call) {
  const standardName = call?.function?.name;
  if (standardName) {
    return {
      id: call?.id,
      name: standardName,
      ...parseStandardToolArguments(call?.function?.arguments),
      rawToolCall: call,
    };
  }

  return call;
}

export async function executeToolCalls({
  toolCalls = [],
  userText = "",
  attachment = null,
  onTransformRequest = null,
  onStartTrainingRequest = null,
  onMoveRequest = null,
  onToolStatus = null,
} = {}) {
  const results = [];

  const emit = (status) => {
    onToolStatus?.({
      at: Date.now(),
      ...status,
    });
  };

  for (const call of toolCalls) {
    const normalizedCall = normalizeToolCall(call);
    const name = normalizeToolName(normalizedCall?.name);
    if (!name) continue;

    if (name === "web_search") {
      const query = normalizedCall.query || userText;
      emit({ tool: name, phase: "running", message: `正在网页搜索：${query}` });
      const result = await webSearch({ query, limit: normalizedCall.limit || 5, summarize: true });
      emit({ tool: name, phase: "done", message: `网页搜索完成：找到 ${(result.results ?? []).length} 个结果` });
      results.push({ name, call: normalizedCall, result });
      continue;
    }

    if (name === "read_document") {
      const label = attachment?.file?.name || normalizedCall.arxiv_id || normalizedCall.url || "document";
      emit({ tool: name, phase: "running", message: `正在解析文件：${label}` });
      const result = await readDocument({
        file: attachment?.file ?? null,
        url: normalizedCall.url || "",
        arxivId: normalizedCall.arxiv_id || "",
        task: `请结合用户问题阅读材料。用户问题：${userText}`,
      });
      emit({ tool: name, phase: "done", message: `文件解析完成：${result.source?.name || label}` });
      results.push({ name, call: normalizedCall, result });
      continue;
    }

    if (name === "code_search") {
      const query = normalizedCall.query || userText;
      emit({ tool: name, phase: "running", message: `正在搜索代码：${query}` });
      const result = await searchCode({
        query,
        path: normalizedCall.path || "",
        pattern: normalizedCall.pattern || "*",
        limit: normalizedCall.limit || 80,
      });
      emit({ tool: name, phase: "done", message: `代码搜索完成：找到 ${(result.results ?? []).length} 条结果` });
      results.push({ name, call: normalizedCall, result });
      continue;
    }

    if (name === "code_read") {
      emit({ tool: name, phase: "running", message: `正在解析文件：${normalizedCall.path}` });
      const result = await readCodeFile({ path: normalizedCall.path || "" });
      emit({ tool: name, phase: "done", message: `文件解析完成：${result.path || normalizedCall.path}` });
      results.push({ name, call: normalizedCall, result });
      continue;
    }

    if (name === "code_list") {
      emit({ tool: name, phase: "running", message: `正在检索 MIKI 项目目录：${normalizedCall.path || "."}` });
      const result = await listCodeFiles({
        path: normalizedCall.path || "",
        pattern: normalizedCall.pattern || "*",
        recursive: normalizedCall.recursive !== false,
        limit: normalizedCall.limit || 160,
      });
      emit({ tool: name, phase: "done", message: `目录检索完成：找到 ${(result.items ?? []).length} 个条目` });
      results.push({ name, call: normalizedCall, result });
      continue;
    }

    if (name === "config_context") {
      emit({ tool: name, phase: "running", message: "正在读取当前训练配置……" });
      const result = await fetchCurrentTrainConfig();
      emit({ tool: name, phase: "done", message: "已加载当前训练配置" });
      results.push({ name, call: normalizedCall, result });
      continue;
    }

    if (name === "transform_model") {
      const targetModel =
        normalizedCall.target_model === "normal" || normalizedCall.targetModel === "normal"
          ? "normal"
          : "magical";
      emit({
        tool: name,
        phase: "running",
        message: targetModel === "magical" ? "正在变身……" : "正在解除变身……",
      });

      const result =
        typeof onTransformRequest === "function"
          ? await onTransformRequest({ targetModel, call: normalizedCall, userText })
          : {
              ok: false,
              error: "transform handler is unavailable",
              targetModel,
            };

      emit({
        tool: name,
        phase: result?.ok ? "done" : "error",
        message: result?.ok
          ? targetModel === "magical"
            ? "变身完成"
            : "已回到日常形态"
          : result?.error || "变身失败",
      });
      results.push({ name, call: normalizedCall, result });
      continue;
    }

    if (name === "start_training") {
      emit({
        tool: name,
        phase: "running",
        message: "正在启动训练……",
      });

      const result =
        typeof onStartTrainingRequest === "function"
          ? await onStartTrainingRequest({ call: normalizedCall, userText })
          : {
              ok: false,
              error: "start training handler is unavailable",
            };

      emit({
        tool: name,
        phase: result?.ok ? "done" : "error",
        message: result?.ok
          ? "训练已启动"
          : result?.error || "训练启动失败",
      });
      results.push({ name, call: normalizedCall, result });
      continue;
    }

    if (name === "moving") {
      emit({
        tool: name,
        phase: "running",
        message: "正在调整站位……",
      });

      const result =
        typeof onMoveRequest === "function"
          ? await onMoveRequest({ call: normalizedCall, userText })
          : {
              ok: false,
              error: "move handler is unavailable",
            };

      emit({
        tool: name,
        phase: result?.ok ? "done" : "error",
        message: result?.ok ? "站位已调整" : result?.error || "站位调整失败",
      });
      results.push({ name, call: normalizedCall, result });
      continue;
    }

    if (name === "memory_retrieve") {
      const query = normalizedCall.query || userText;
      emit({ tool: name, phase: "running", message: `正在检索长期记忆：${query}` });
      const result = await retrieveLongTermMemory({ query, limit: normalizedCall.limit || 6 });
      emit({ tool: name, phase: "done", message: "长期记忆检索完成" });
      results.push({ name, call: normalizedCall, result });
    }
  }

  return results;
}
