import { buildProgramConfigPrompt } from "../programPrompt";
import { executeToolCalls } from "./toolExecutor";
import { buildToolAugmentedPrompt, collectToolReferences } from "./toolResultPrompt";
import { routeTools } from "./toolRouterService";

export async function prepareToolRoutedContext({
  text = "",
  attachment = null,
  recentMessages = [],
  onTransformRequest = null,
  onStartTrainingRequest = null,
  onMoveRequest = null,
  onToolStatus = null,
  onPrelude = null,
} = {}) {
  const hasAttachment = Boolean(attachment?.file);

  onToolStatus?.({
    tool: "tool-router",
    phase: "running",
    message: "正在思考……",
    at: Date.now(),
  });

  const routed = await routeTools({
    message: text,
    hasAttachment,
    attachmentName: attachment?.file?.name || "",
    recentMessages,
  });

  const toolCalls = Array.isArray(routed.standard_tool_calls)
    ? routed.standard_tool_calls
    : Array.isArray(routed.tool_calls)
      ? routed.tool_calls
      : [];
  const prelude = String(routed.prelude || "").trim();

  if (toolCalls.length === 0) {
    onToolStatus?.({
      tool: "tool-router",
      phase: "done",
      message: "正在思考……",
      at: Date.now(),
    });
    return {
      promptText: text,
      prelude: "",
      references: [],
      usedTools: [],
      toolResults: [],
    };
  }

  if (prelude) {
    onPrelude?.(prelude);
  }

  onToolStatus?.({
    tool: "tool-router",
    phase: "done",
    message: "正在思考……",
    at: Date.now(),
  });

  const toolResults = await executeToolCalls({
    toolCalls,
    userText: text,
    attachment,
    onTransformRequest,
    onStartTrainingRequest,
    onMoveRequest,
    onToolStatus,
  });

  onToolStatus?.({
    tool: "prompt",
    phase: "done",
    message: "正在思考……",
    at: Date.now(),
  });

  let promptText = buildToolAugmentedPrompt({
    userText: text,
    toolResults,
  });

  const configResult = toolResults.find((item) => item.name === "config_context")?.result;
  if (configResult) {
    promptText = buildProgramConfigPrompt({
      userText: promptText,
      configPayload: configResult,
    });
  }

  return {
    promptText,
    prelude,
    references: collectToolReferences(toolResults),
    usedTools: toolResults.map((item) => item.name),
    toolResults,
  };
}
