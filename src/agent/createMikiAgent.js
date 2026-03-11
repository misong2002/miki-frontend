export function createMikiAgent({
  character,
  language,
  memory = null,
}) {
  if (!character?.dispatch) {
    throw new Error("createMikiAgent: character.dispatch is required");
  }

  if (!language?.hear || !language?.interrupt) {
    throw new Error("createMikiAgent: language.hear and language.interrupt are required");
  }

  async function hear(input, handlers = {}) {
    const userText = typeof input === "string" ? input : input?.text ?? "";
    const messageId =
      typeof input === "string"
        ? `miki-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        : input?.messageId ??
          `miki-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const trimmed = userText.trim();
    if (!trimmed) {
      return {
        status: "idle",
        text: "",
        error: null,
      };
    }

    // 1. 角色听到用户输入
    character.dispatch({
      type: "USER_ACTIVE",
      source: "chat_input",
    });

    // 2. 回忆（先留最小接口，后面可接真实 memory）
    let memoryContext = null;
    if (memory?.recall) {
      try {
        memoryContext = await memory.recall({
          text: trimmed,
        });
      } catch (err) {
        console.warn("[MikiAgent] memory.recall failed:", err);
      }
    }

    if (memoryContext && language?.remind) {
      language.remind(memoryContext);
    }

    // 3. 让 language 负责流式输出、控制符解析、printer、角色阶段事件
    const result = await language.hear(
      {
        text: trimmed,
        messageId,
        memoryContext,
      },
      handlers
    );

    // 4. 写回记忆（先占位）
    if (memory?.rememberTurn) {
      try {
        await memory.rememberTurn({
          user: trimmed,
          assistant: result?.text ?? "",
        });
      } catch (err) {
        console.warn("[MikiAgent] memory.rememberTurn failed:", err);
      }
    }

    return result;
  }

  function interrupt() {
    return language.interrupt();
  }

  function isBusy() {
    return language.isBusy?.() ?? false;
  }

  return {
    hear,
    interrupt,
    isBusy,
    language,
    memory,
    character,
  };
}