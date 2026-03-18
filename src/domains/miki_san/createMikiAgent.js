// src/domains/miki_san/createMikiAgent.js
import { createCharacterRuntimeBridge } from "./motor/characterRuntimeBridge";
import { createCharacterOrchestrator } from "./motor/characterOrchestrator";
import { createLanguageModule } from "./language/languageModule";
import { emotionEngine } from "./body/bodyModule.js";
import { emotionMapper } from "./motor/emotionMapper";
import { motionMapper } from "./motor/motionMapper";
import { createExternalityModule } from "./externality/createExternalityModule";
import { createPerceptionModule } from "./perception/perceptionModule.js";
import { createMemoryRuntime } from "./memory/memoryModule.js";
import { createTrainingCommentaryPipeline } from "./agent/createTrainingCommentaryPipeline";
import { buildRemindPrompt } from "./agent/remindPromptBuilder";
import { runLanguageTurn } from "./agent/runLanguageTurn";
import { createPerceptionGate } from "./agent/perceptionGate";

/**
 * Agent 内部默认舞台状态。
 * 注意：
 * - 这里故意和 App.jsx 的 DEFAULT_STAGE_PROPS 分离
 * - Agent 管的是角色内部默认外显；UI 层可以有自己的布局默认值
 */
const DEFAULT_STAGE_PROPS = {
  modelKey: "normal",
  position: { x: 0.5, y: 0.85 },
  scale: 1.0,
};

function createMessageId(prefix = "miki") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 统一容错调用。
 * 用法：
 * - 旁路写入失败时不中断主流程
 * - 启动期某些辅助步骤失败时给出 fallback
 */
async function safeCall(fn, fallback = null, label = "safeCall") {
  try {
    if (typeof fn !== "function") return fallback;
    return await fn();
  } catch (err) {
    console.warn(`[MikiAgent] ${label} failed:`, err);
    return fallback;
  }
}

function emitBootPhase(handlers, phase, extra = {}) {
  try {
    handlers?.onBootPhaseChange?.({
      phase,
      ...extra,
    });
  } catch (err) {
    console.warn("[MikiAgent] onBootPhaseChange failed:", err);
  }
}

function formatBattleCommentPrefix(timestamp, epoch) {
  const d = new Date(timestamp);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const epochText = epoch != null ? `epoch ${epoch}` : "epoch ?";
  return `(${hh}:${mm}:${ss} || ${epochText})`;
}

/**
 * 是否是一条“启动回忆”消息。
 * 这类消息可以显示给 UI，
 * 但不应该再作为下一次 remind 的原始对话材料，
 * 否则会出现“对总结的总结”不断叠加。
 */
function isBootRemindMessage(msg) {
  return msg?.meta?.source === "boot_remind";
}

/**
 * 收集 remind 用的最近消息。
 *
 * 关键策略：
 * - 从最近 wakeCycle 里拿消息
 * - 过滤掉 boot_remind，避免重启多次后不断把旧总结再总结一遍
 */
async function collectRecentMessagesForRemind(memory, limitWakeCycles = 3) {
  const messages = await safeCall(
    () => memory?.listRecentMessagesAcrossWakeCycles?.(limitWakeCycles),
    [],
    "memory.listRecentMessagesAcrossWakeCycles"
  );

  if (!Array.isArray(messages)) return [];

  return messages.filter((msg) => !isBootRemindMessage(msg));
}

/**
 * 给 UI 恢复消息时做标准化。
 *
 * 注意：
 * - 这里不过滤 boot_remind
 * - 因为 UI 恢复时，用户就是应该能看到“她刚刚完成了回忆”
 */
function normalizeBootstrapMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter(Boolean)
    .map((msg) => ({
      id:
        msg?.id ??
        createMessageId(
          msg?.role === "user" ? "user-restored" : "assistant-restored"
        ),
      role: msg?.role ?? "assistant",
      content: msg?.content ?? "",
      createdAt: msg?.createdAt ?? Date.now(),
      status: msg?.status ?? "done",
      references: Array.isArray(msg?.references) ? msg.references : [],
      meta: {
        ...(msg?.meta ?? {}),
      },
    }));
}

/**
 * 训练状态语义归一化。
 *
 * 之前的问题是：
 * - semantic === "none" 时直接 return
 * - 这会导致角色保留上一轮 training semantic，状态残留
 *
 * 现在改成：
 * - running + none/null -> normal
 * - idle / 其它非 running -> idle
 */
function normalizeTrainingSemantic(status = "idle", semantic = "idle") {
  if (semantic && semantic !== "none") {
    return semantic;
  }

  return status === "running" ? "normal" : "idle";
}

export function createMikiAgent({
  memory: injectedMemory = null,
  onStageChange = null,
} = {}) {
  const runtimeBridge = createCharacterRuntimeBridge({
    emotionEngine,
  });

  const character = createCharacterOrchestrator({
    runtimeBridge,
    emotionMapper,
    motionMapper,
  });

  if (!character?.dispatch) {
    throw new Error("createMikiAgent: character.dispatch is required");
  }

  const memory = injectedMemory ?? createMemoryRuntime();

  const perception = createPerceptionModule();
  const perceptionGate = createPerceptionGate({
    cooldownMs: 5000,
    sameFeatureSuppressMs: 30000,
  });

  const language = createLanguageModule({
    onCharacterEvent: (event) => {
      character.dispatch(event);
    },
  });

  if (!language?.hear || !language?.interrupt) {
    throw new Error(
      "createMikiAgent: language.hear and language.interrupt are required"
    );
  }

  const stageListeners = new Set();

  function emitStageChange(nextStageProps) {
    for (const listener of stageListeners) {
      try {
        listener?.(nextStageProps);
      } catch (err) {
        console.warn("[MikiAgent] stage listener failed:", err);
      }
    }
  }

  const externality = createExternalityModule({
    initialModelKey: DEFAULT_STAGE_PROPS.modelKey,
    initialPosition: DEFAULT_STAGE_PROPS.position,
    initialScale: DEFAULT_STAGE_PROPS.scale,
    onChange: (nextStageProps) => {
      emitStageChange(nextStageProps);
      onStageChange?.(nextStageProps);
    },
  });

  const contactListeners = new Set();

  /**
   * 启动生命周期控制：
   * - hasStarted：仅在“启动关键步骤完成”后置 true
   * - startPromise：并发 start 时复用同一个 promise
   * - memoryBootPromise / hasMemoryBooted：把 memory.boot 纳入启动生命周期，并保证只 boot 一次
   */
  let hasStarted = false;
  let startPromise = null;
  let hasMemoryBooted = false;
  let memoryBootPromise = null;

  async function ensureMemoryBooted() {
    if (hasMemoryBooted) return;
    if (memoryBootPromise) return memoryBootPromise;

    memoryBootPromise = (async () => {
      await safeCall(() => memory?.boot?.(), null, "memory.boot");
      hasMemoryBooted = true;
    })();

    try {
      await memoryBootPromise;
    } finally {
      memoryBootPromise = null;
    }
  }

  function touchMemory() {
    if (typeof memory?.touch === "function") {
      memory.touch();
    }
  }

  function emitContactFeed(payload) {
    for (const listener of contactListeners) {
      try {
        listener?.(payload);
      } catch (err) {
        console.warn("[MikiAgent] contact listener failed:", err);
      }
    }
  }

  function getStageProps() {
    return externality.getState();
  }

  function setAppMode(mode) {
    character.dispatch({
      type: "APP_MODE_CHANGED",
      mode,
    });
  }

  function setTrainingStatus(status = "idle", semantic = "idle") {
    const normalizedSemantic = normalizeTrainingSemantic(status, semantic);

    character.dispatch({
      type: "TRAINING_STATUS",
      payload: {
        status,
        semantic: normalizedSemantic,
      },
    });
  }

  function setUserActive(source = "app") {
    /**
     * 用户活跃是一个明确的“外部唤醒”事件。
     * 这里保留 touchMemory。
     */
    touchMemory();

    character.dispatch({
      type: "USER_ACTIVE",
      source,
    });
  }

  async function getBootstrapMessages() {
    await ensureMemoryBooted();

    const messages = await safeCall(
      () => memory?.listRecentMessagesAcrossWakeCycles?.(3),
      [],
      "memory.listRecentMessagesAcrossWakeCycles(bootstrap)"
    );

    return normalizeBootstrapMessages(messages);
  }

  async function rememberAssistantMessage(
    text,
    meta = {},
    label = "memory.recordAssistantMessage"
  ) {
    if (!text?.trim()) return null;

    return safeCall(
      () => memory?.recordAssistantMessage?.(text, meta),
      null,
      label
    );
  }

  /**
   * 统一执行一个 agent 语言回合。
   *
   * 负责：
   * -（可选）touchMemory
   * - 调 runLanguageTurn
   * - 记录 assistant message
   * - 返回统一 turn 结果
   *
   * 不负责：
   * - 写 user message
   * - 构造 remind prompt
   * - rememberTurn
   */
  async function runAgentTurn({
    inputText,
    messageId,
    handlers = {},
    assistantMeta = {},
    assistantRecordLabel = "memory.recordAssistantMessage",
    shouldTouchMemory = true,
    languageOptions = {},
  }) {
    if (shouldTouchMemory) {
      await touchMemory("runAgentTurn");
    }

    const turn = await runLanguageTurn(
      language,
      {
        text: inputText,
        messageId,
      },
      handlers,
      languageOptions
    );

    const assistantText = turn?.assistantText ?? "";

    if (assistantText.trim()) {
      await safeCall(
        () =>
          memory?.recordAssistantMessage?.(assistantText, {
            messageId,
            interrupted: Boolean(turn?.interrupted),
            error: turn?.error ? String(turn.error) : null,
            ...assistantMeta,
          }),
        null,
        assistantRecordLabel
      );
    }

    return turn;
  }

  async function remind(handlers = {}) {
    await ensureMemoryBooted();

    const messages = await collectRecentMessagesForRemind(memory, 3);
    console.log("[MikiAgent.remind] collected messages for remind =", messages);
    if (messages.length === 0) {
      return {
        status: "idle",
        text: "",
        error: null,
      };
    }

    let longTermMemory = null;

    try {
      if (memory?.fetchLongTermSystemPromptMemory) {
        longTermMemory = await memory.fetchLongTermSystemPromptMemory();
      }
    } catch (err) {
      console.warn("[remind] fetchLongTermSystemPromptMemory failed:", err);
    }
    //日志输出长期记忆内容
    console.log("[remind] loaded longTermMemory =", longTermMemory);
    const prompt = buildRemindPrompt(messages, longTermMemory);

    if (!prompt.trim()) {
      return {
        status: "idle",
        text: "",
        error: null,
      };
    }

    const messageId = createMessageId("miki-remind");
    console.log("[MikiAgent.remind] running remind");
    const turnResult = await runAgentTurn({
      inputText: prompt,
      messageId,
      handlers,
      assistantMeta: {
        source: "boot_remind",
      },
      assistantRecordLabel: "memory.recordAssistantMessage(remind)",
      shouldTouchMemory: true,
      languageOptions: {
        awaitDisplayDrain: false,
      },
    });
    console.log("[MikiAgent.remind] finished reminding ");
    return {
      status: turnResult.status,
      text: turnResult.text,
      error: turnResult.error,
    };
  }

  async function hear(input, handlers = {}) {
    const userText = typeof input === "string" ? input : input?.text ?? "";
    const messageId =
      typeof input === "string"
        ? createMessageId("miki")
        : input?.messageId ?? createMessageId("miki");

    const trimmed = userText.trim();

    if (!trimmed) {
      return {
        status: "idle",
        text: "",
        error: null,
      };
    }

    /**
     * chat_input 本身就是一次 user active 事件。
     * 这里会 touchMemory，所以后续 runAgentTurn 不再重复 touch。
     */
    setUserActive("chat_input");

    await ensureMemoryBooted();

    await safeCall(
      () => memory?.recordUserMessage?.(trimmed, { messageId }),
      null,
      "memory.recordUserMessage"
    );

    const turnResult = await runAgentTurn({
      inputText: trimmed,
      messageId,
      handlers,
      assistantMeta: {},
      assistantRecordLabel: "memory.recordAssistantMessage",
      shouldTouchMemory: false,
    });

    await safeCall(
      () =>
        memory?.rememberTurn?.({
          messageId,
          user: trimmed,
          assistant: turnResult.text,
          interrupted: Boolean(turnResult.interrupted),
          hadError: Boolean(turnResult.error),
        }),
      null,
      "memory.rememberTurn"
    );

    return {
      status: turnResult.status,
      text: turnResult.text,
      error: turnResult.error,
    };
  }

  const trainingCommentaryPipeline = createTrainingCommentaryPipeline({
    perception,
    perceptionGate,
    setTrainingStatus,
    recordObservation: (observation) =>
      memory?.recordTrainingObservation?.(observation),
    emitContactFeed,
    safeCall,
    formatBattleCommentPrefix,
  });

  function interrupt() {
    return language.interrupt();
  }

  function isBusy() {
    return language.isBusy?.() ?? false;
  }

  /**
   * Agent 启动阶段。
   *
   * 语义：
   * - memory.boot 归入这里，不在 create 时偷跑
   * - 如果 memory 中存在“可恢复上下文”，就执行一次 remind
   * - UI 有历史消息，不等于 LLM 已有上下文
   * - 只有关键步骤成功，才把 hasStarted 置 true
   *
   * 这样做可以修复之前那个问题：
   * - boot remind 失败了，但 hasStarted 已经被置 true
   * - 导致之后再也不会尝试恢复上下文
   */
  async function start(handlers = {}) {
    if (hasStarted) {
      emitBootPhase(handlers, "ready");
      return;
    }

    if (startPromise) return startPromise;

    startPromise = (async () => {
      emitBootPhase(handlers, "summarizing");

      await ensureMemoryBooted();

      await safeCall(
        () => memory?.archiveStaleWakeCyclesIfNeeded?.(),
        null,
        "memory.archiveStaleWakeCyclesIfNeeded"
      );

      const recoverableMessages = await collectRecentMessagesForRemind(memory, 3);
      const hasRecoverableContext = recoverableMessages.length > 0;

      console.log(
        "[MikiAgent.start]",
        "recoverableMessages =",
        recoverableMessages.length,
        "| action =",
        hasRecoverableContext ? "boot_remind" : "skip_remind"
      );

      let remindResult = {
        status: "idle",
        text: "",
        error: null,
      };

      if (hasRecoverableContext) {
        emitBootPhase(handlers, "reminding");

        remindResult = await safeCall(
          () => remind(),
          {
            status: "error",
            text: "",
            error: new Error("boot remind failed"),
          },
          "agent.remindOnBoot"
        );
      }

      const bootSucceeded =
        !hasRecoverableContext ||
        (remindResult && remindResult.status !== "error");

      if (bootSucceeded) {
        hasStarted = true;
        emitBootPhase(handlers, "ready");
      } else {
        emitBootPhase(handlers, "error", {
          error: remindResult?.error ?? null,
        });
      }
    })();

    try {
      return await startPromise;
    } finally {
      startPromise = null;
    }
  }

  function subscribeStage(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }

    stageListeners.add(listener);

    return () => {
      stageListeners.delete(listener);
    };
  }

  function setStagePreset(nextStageProps = {}) {
    externality.patch(nextStageProps);
  }

  function resetStage() {
    externality.patch(DEFAULT_STAGE_PROPS);
  }

  function subscribeContactFeed(cb) {
    if (typeof cb !== "function") {
      return () => {};
    }

    contactListeners.add(cb);

    return () => {
      contactListeners.delete(cb);
    };
  }

  function getDebugAPI() {
    return {
      getCharacterState: () => character.getState?.(),
      dispatchCharacter: (event) => character.dispatch(event),

      /**
       * 这些是开发调试入口，不建议业务层依赖。
       */
      getMemory: () => memory,
      dumpMemoryDB: () => memory?.dump?.(),

      resetMemoryDB: async () => {
        const mod = await import("./memory/memoryModule.js");
        mod.resetMemoryDB?.();
      },

      hear: async (text) => {
        return hear(
          {
            text,
            messageId: "debug-agent",
          },
          {
            onThinkingStart: () => console.log("[debug hear] thinking"),
            onTextChunk: (chunk) => console.log("[debug hear] chunk:", chunk),
            onTextUpdate: (fullText) =>
              console.log("[debug hear] full:", fullText),
            onDone: (finalText) => console.log("[debug hear] done:", finalText),
            onInterrupted: (partialText) =>
              console.log("[debug hear] interrupted:", partialText),
            onError: (err, partialText) =>
              console.error("[debug hear] error:", err, partialText),
          }
        );
      },

      remindAgent: async () => {
        return remind({
          onThinkingStart: () => console.log("[debug remind] thinking"),
          onTextChunk: (chunk) => console.log("[debug remind] chunk:", chunk),
          onTextUpdate: (fullText) =>
            console.log("[debug remind] full:", fullText),
          onDone: (finalText) => console.log("[debug remind] done:", finalText),
          onInterrupted: (partialText) =>
            console.log("[debug remind] interrupted:", partialText),
          onError: (err, partialText) =>
            console.error("[debug remind] error:", err, partialText),
        });
      },

      interruptAgent: () => interrupt(),
      isAgentBusy: () => isBusy(),

      userActive: (source = "debug") => setUserActive(source),
      setCharacterMode: (nextMode) => setAppMode(nextMode),
      setTrainingStatus: (status = "idle", semantic = "idle") =>
        setTrainingStatus(status, semantic),

      perceptionGate: {
        getState: () => perceptionGate.getState(),
        reset: () => perceptionGate.reset(),
      },

      externality: {
        getState: () => externality.getState(),
        setModelKey: (modelKey) => externality.setModelKey(modelKey),
        setPosition: (position) => externality.setPosition(position),
        setScale: (scale) => externality.setScale(scale),
        patch: (partial) => externality.patch(partial),
        reset: () => resetStage(),
      },
    };
  }

  return {
    chat: {
      sendUserMessage: hear,
      runRemindTurn: remind,
      interrupt,
      isBusy,
      getBootstrapMessages,
    },

    app: {
      start,
      setMode: setAppMode,
      notifyUserActivity: setUserActive,
    },

    battle: {
      submitLossData: trainingCommentaryPipeline.handleLossUpdate,
      subscribeContactFeed,
      setTrainingSemantic: setTrainingStatus,
      interrupt,
    },

    stage: {
      getSnapshot: getStageProps,
      subscribe: subscribeStage,
      setPreset: setStagePreset,
      reset: resetStage,
    },

    getDebugAPI,
  };
}