import { buildCodeAgentContext, buildCodeAgentPrompt } from "./codeAgentPrompt";
import { listCodeFiles, readCodeFile, searchCode } from "./codeAgentService";
import { detectCodeAgentIntent } from "./codeAgentTriggers";

function deriveSearchQuery(text = "") {
  return String(text || "")
    .replace(/搜索|查找|找一下|检索|代码|文件|函数|组件|脚本|接口|模块/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function prepareCodeAgentContext({
  text = "",
  onToolStatus = null,
} = {}) {
  const intent = detectCodeAgentIntent(text);

  if (!intent.shouldRun) {
    return {
      promptText: text,
      usedTools: [],
      codeResult: null,
    };
  }

  const emit = (status) => {
    onToolStatus?.({
      at: Date.now(),
      ...status,
    });
  };

  let result = null;

  if (intent.mode === "list") {
    emit({
      tool: "code-agent",
      phase: "running",
      message: `正在检索 MIKI 项目目录：${intent.path || "."}`,
    });
    result = await listCodeFiles({
      path: intent.path || "",
      pattern: "*",
      recursive: true,
      limit: 160,
    });
  }

  if (intent.mode === "search") {
    const query = deriveSearchQuery(intent.query) || intent.query;
    emit({
      tool: "code-agent",
      phase: "running",
      message: `正在搜索代码：${query}`,
    });
    result = await searchCode({
      query,
      path: "",
      pattern: "*",
      limit: 80,
    });
  }

  if (intent.mode === "read") {
    if (!intent.path) {
      emit({
        tool: "code-agent",
        phase: "done",
        message: "需要明确文件路径才能阅读脚本。",
      });
      return {
        promptText: `${text}\n\n[代码 agent 提示]\n需要明确文件路径才能阅读脚本。`,
        usedTools: ["code-agent"],
        codeResult: null,
      };
    }

    emit({
      tool: "code-agent",
      phase: "running",
      message: `正在解析文件：${intent.path}`,
    });
    result = await readCodeFile({
      path: intent.path,
    });
  }

  emit({
    tool: "code-agent",
    phase: "done",
    message:
      intent.mode === "search"
        ? `代码搜索完成：找到 ${(result?.results ?? []).length} 条结果`
        : intent.mode === "list"
          ? `目录检索完成：找到 ${(result?.items ?? []).length} 个条目`
          : `文件解析完成：${result?.path || intent.path}`,
  });

  const codeContext = buildCodeAgentContext({
    mode: intent.mode,
    result,
  });

  return {
    promptText: buildCodeAgentPrompt({
      userText: text,
      codeContext,
    }),
    usedTools: ["code-agent"],
    codeResult: result,
  };
}
