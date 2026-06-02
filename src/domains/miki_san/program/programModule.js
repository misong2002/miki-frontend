import { buildProgramConfigPrompt } from "./programPrompt";
import { fetchCurrentTrainConfig, patchTrainConfig } from "./programService";
import { detectConfigChangeIntent } from "./programTriggers";

export const PROGRAM_CONFIG_MODIFIED_EVENT = "miki:program-config-modified";

function emitProgramConfigModified(detail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(PROGRAM_CONFIG_MODIFIED_EVENT, {
      detail,
    })
  );
}

export async function prepareProgramContext({
  text = "",
  detectText = "",
  onToolStatus = null,
} = {}) {
  const intent = detectConfigChangeIntent(detectText || text);

  if (!intent.shouldInjectConfig) {
    return {
      promptText: text,
      usedTools: [],
    };
  }

  onToolStatus?.({
    tool: "program-config",
    phase: "running",
    message: "正在读取当前训练配置……",
    at: Date.now(),
  });

  const configPayload = await fetchCurrentTrainConfig();

  onToolStatus?.({
    tool: "program-config",
    phase: "done",
    message: "已加载当前训练配置，正在判断参数修改……",
    at: Date.now(),
  });

  return {
    promptText: buildProgramConfigPrompt({
      userText: text,
      configPayload,
    }),
    usedTools: ["program-config"],
  };
}

export async function applyProgramControl(event) {
  if (event?.type !== "config" || event?.op !== "set") {
    return null;
  }

  const result = await patchTrainConfig({
    path: event.path,
    value: event.value,
  });

  emitProgramConfigModified({
    path: event.path,
    value: event.value,
    result,
  });

  return result;
}
