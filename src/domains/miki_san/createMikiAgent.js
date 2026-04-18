// src/domains/miki_san/createMikiAgent.js
import { createCharacterRuntimeBridge } from "./motor/characterRuntimeBridge";
import {
  createCharacterOrchestrator,
  defaultPickIdlePresentation,
} from "./motor/characterOrchestrator";
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

const DEFAULT_STAGE_PROPS = {
  modelKey: "normal",
  position: { x: 0.5, y: 1.0 },
  scale: 1.0,
};

function createMessageId(prefix = "miki") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createTrainingSummaryTask(prompt) {
  return {
    id: createMessageId("training-summary-task"),
    prompt,
    createdAt: Date.now(),
  };
}

async function safeCall(fn, fallback = null, label = "safeCall") {
  try {
    if (typeof fn !== "function") return fallback;
    return await fn();
  } catch (err) {
    console.warn(`[MikiAgent] ${label} failed:`, err);
    return fallback;
  }
}

function emitBootPhaseToHandlers(handlers, payload) {
  try {
    handlers?.onBootPhaseChange?.(payload);
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

function isBootRemindMessage(msg) {
  return msg?.meta?.source === "boot_remind";
}

function normalizeBootstrapMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter((msg) => typeof msg?.content === "string" && msg.content.trim())
    .map((msg) => ({
      id: msg.id ?? createMessageId("bootstrap"),
      role: msg.role ?? "assistant",
      content: msg.content,
      createdAt: msg.createdAt ?? Date.now(),
      meta: msg.meta ?? {},
    }))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

async function collectRecentMessagesForRemind(memory, wakeCycleCount = 3) {
  const messages =
    (await safeCall(
      () => memory?.listRecentMessagesAcrossWakeCycles?.(wakeCycleCount, 30),
      [],
      "memory.listRecentMessagesAcrossWakeCycles"
    )) ?? [];

  return messages.filter((msg) => !isBootRemindMessage(msg));
}

async function getLatestStoredMessage(memory, wakeCycleCount = 3) {
  const messages =
    (await safeCall(
      () => memory?.listRecentMessagesAcrossWakeCycles?.(wakeCycleCount, 30),
      [],
      "memory.listRecentMessagesAcrossWakeCycles(getLatestStoredMessage)"
    )) ?? [];

  return [...messages].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)).at(-1) ?? null;
}

export function createMikiAgent({
  onStageChange = null,
  initialStageProps = DEFAULT_STAGE_PROPS,
} = {}) {
  const externality = createExternalityModule({
    initialModelKey: initialStageProps?.modelKey ?? DEFAULT_STAGE_PROPS.modelKey,
    initialPosition: initialStageProps?.position ?? DEFAULT_STAGE_PROPS.position,
    initialScale: initialStageProps?.scale ?? DEFAULT_STAGE_PROPS.scale,
    onChange: onStageChange,
  });

  const runtimeBridge = createCharacterRuntimeBridge({
    emotionEngine,
  });

  const character = createCharacterOrchestrator({
    runtimeBridge,
    emotionMapper,
    motionMapper,
  });

  const language = createLanguageModule({
    onCharacterEvent: (event) => {
      character.dispatch(event);
    },
  });

  const perception = createPerceptionModule();
  const perceptionGate = createPerceptionGate();
  const memory = createMemoryRuntime();

  let hasStarted = false;
  let startPromise = null;
  let memoryBootPromise = null;
  let hasMemoryBooted = false;
  let pendingTrainingSummaryTask = null;
  let bootPhaseState = {
    phase: "idle",
  };
  const bootPhaseListeners = new Set();

  let trainingStatus = {
    status: "idle",
    semantic: "idle",
  };

  function emitStageChange(nextStageProps) {
    externality?.patch?.(nextStageProps);
  }

  function setTrainingStatus(status = "idle", semantic = "idle") {
    trainingStatus = { status, semantic };

    character.dispatch({
      type: "TRAINING_STATUS",
      payload: {
        status,
        semantic,
      },
    });
  }

  function emitContactFeed(payload) {
    externality?.emitContactFeed?.(payload);
  }

  function subscribeContactFeed(listener) {
    return externality?.subscribeContactFeed?.(listener) ?? (() => {});
  }

  function emitBootPhase(phase, extra = {}, handlers = null) {
    const payload = {
      phase,
      ...extra,
    };

    bootPhaseState = payload;

    bootPhaseListeners.forEach((listener) => {
      try {
        listener(payload);
      } catch (err) {
        console.warn("[MikiAgent] boot phase listener failed:", err);
      }
    });

    emitBootPhaseToHandlers(handlers, payload);
    return payload;
  }

  function subscribeBootPhase(listener, { emitCurrent = true } = {}) {
    if (typeof listener !== "function") return () => {};

    bootPhaseListeners.add(listener);

    if (emitCurrent && bootPhaseState) {
      try {
        listener(bootPhaseState);
      } catch (err) {
        console.warn("[MikiAgent] boot phase listener failed:", err);
      }
    }

    return () => {
      bootPhaseListeners.delete(listener);
    };
  }

  function getBootPhase() {
    return bootPhaseState;
  }

  function getCurrentWakeCycleIdSafe() {
    return memory?.getCurrentWakeCycleId?.() ?? null;
  }

  async function ensureMemoryBooted() {
    if (hasMemoryBooted) return true;
    if (memoryBootPromise) return memoryBootPromise;

    memoryBootPromise = (async () => {
      const booted = await safeCall(
        () => memory?.boot?.(),
        null,
        "memory.boot"
      );

      if (booted) {
        hasMemoryBooted = true;
        return true;
      }

      return false;
    })();

    const result = await memoryBootPromise;
    memoryBootPromise = null;
    return result;
  }

  function touchMemory(source = "agent") {
    if (typeof memory?.touch === "function") {
      return memory.touch(source);
    }
    return null;
  }

  function setUserActive(source = "user_active") {
    touchMemory(source);

    character.dispatch({
      type: "USER_ACTIVE",
      source,
    });
  }

  function setUserIdle(source = "user_idle") {
    character.dispatch({
      type: "USER_IDLE",
      source,
    });
  }

  function setMode(mode = "chat") {
    const normalizedMode =
      mode === "battle" || mode === "transforming" ? mode : "chat";

    emotionEngine.setMode(normalizedMode);

    return {
      ok: true,
      mode: normalizedMode,
    };
  }

  async function getBootstrapMessages() {
    await ensureMemoryBooted();

    const messages = await safeCall(
      () => memory?.listRecentMessagesAcrossWakeCycles?.(3, 30),
      [],
      "memory.listRecentMessagesAcrossWakeCycles(getBootstrapMessages)"
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

  async function runAgentTurn({
    inputText,
    messageId,
    messageType = "user",
    handlers = {},
    assistantMeta = {},
    assistantRecordLabel = "memory.recordAssistantMessage",
    shouldRecordAssistantMessage = true,
    shouldTouchMemory = true,
    languageOptions = {},
  }) {
    if (shouldTouchMemory) {
      touchMemory("runAgentTurn");
    }

    const turn = await runLanguageTurn(
      language,
      {
        text: inputText,
        messageId,
        messageType,
      },
      handlers,
      languageOptions
    );

    const assistantText = turn?.assistantText ?? "";

    if (shouldRecordAssistantMessage && assistantText.trim()) {
      await safeCall(
        () =>
          memory?.recordAssistantMessage?.(assistantText, {
            messageId,
            interrupted: Boolean(turn?.interrupted),
            error: turn?.errorObj ? String(turn.errorObj) : null,
            ...assistantMeta,
          }),
        null,
        assistantRecordLabel
      );
    }

    return turn;
  }

  function queueTrainingSummaryPrompt(prompt = "") {
    const text = typeof prompt === "string" ? prompt.trim() : "";

    if (!text) {
      return {
        ok: true,
        queued: false,
      };
    }

    pendingTrainingSummaryTask = createTrainingSummaryTask(text);

    return {
      ok: true,
      queued: true,
      pendingCount: pendingTrainingSummaryTask ? 1 : 0,
    };
  }

  function hasPendingTrainingSummaryPrompt() {
    return Boolean(pendingTrainingSummaryTask);
  }

  function consumePendingTrainingSummaryTask(consumer = "unknown") {
    const nextTask = pendingTrainingSummaryTask;

    if (!nextTask) {
      return null;
    }

    pendingTrainingSummaryTask = null;

    return {
      ...nextTask,
      consumer,
    };
  }

  async function runPendingTrainingSummaryQuery(handlers = {}) {
    const startedAt = Date.now();
    console.log("[MikiAgent.trainingSummary] start");
    await ensureMemoryBooted();

    const task = consumePendingTrainingSummaryTask("training_summary_query");
    const prompt = task?.prompt ?? "";

    if (!prompt) {
      console.log("[MikiAgent.trainingSummary] skipped: no prompt", { durationMs: Date.now() - startedAt });
      return {
        status: "idle",
        text: "",
        error: null,
        messageId: null,
        meta: {
          source: "training_summary_query",
        },
      };
    }

    const messageId = createMessageId("miki-training-summary");
    const turnResult = await runAgentTurn({
      inputText:
        `${prompt}

请把这次训练当成你自己刚刚亲身打完的一场战斗来回顾，用第一人称说话。
不要用“Miki 她……”或者“她刚刚……”这种第三者视角。
请直接用“我刚刚……”“我这次……”这样的说法。
请基于这段训练结果，用自然口吻向用户说 1 到 3 句话，简短总结这次训练。`,
      messageId,
      handlers,
      assistantMeta: {
        source: "training_summary_query",
      },
      assistantRecordLabel: "memory.recordAssistantMessage(training_summary_query)",
      shouldRecordAssistantMessage: true,
      shouldTouchMemory: true,
      languageOptions: {
        awaitDisplayDrain: false,
      },
    });

    console.log("[MikiAgent.trainingSummary] complete", {
      durationMs: Date.now() - startedAt,
      status: turnResult?.result?.status ?? "done",
      hasText: Boolean(turnResult?.assistantText ?? ""),
      messageId,
      taskId: task?.id ?? null,
    });

    return {
      status: turnResult?.result?.status ?? "done",
      text: turnResult?.assistantText ?? "",
      error: turnResult?.errorObj ?? null,
      messageId,
      meta: {
        source: "training_summary_query",
      },
    };
  }

  async function remind(handlers = {}) {
    const startedAt = Date.now();
    console.log("[MikiAgent.remind] start");
    await ensureMemoryBooted();

    const latestStoredMessage = await getLatestStoredMessage(memory, 3);
    const previousReplyWasBootRemind = isBootRemindMessage(latestStoredMessage);

    const messages = await collectRecentMessagesForRemind(memory, 3);
    // console.log("[MikiAgent.remind] collected messages for remind =", messages);

    if (messages.length === 0) {
      console.log("[MikiAgent.remind] skipped: no messages", { durationMs: Date.now() - startedAt });
      return {
        status: "idle",
        text: "",
        error: null,
        messageId: null,
        meta: {
          source: "boot_remind",
        },
      };
    }

    let longTermMemory = null;

    try {
      console.log("[MikiAgent.remind] fetching long-term memory");
      if (memory?.fetchLongTermSystemPromptMemory) {
        longTermMemory = await memory.fetchLongTermSystemPromptMemory();
      }
      console.log("[MikiAgent.remind] fetched long-term memory", {
        durationMs: Date.now() - startedAt,
        hasLongTermMemory: Boolean(longTermMemory),
      });
    } catch (err) {
      console.warn("[remind] fetchLongTermSystemPromptMemory failed:", err);
    }

    // console.log("[remind] loaded longTermMemory =", longTermMemory);

    const trainingSummaryTask = consumePendingTrainingSummaryTask("boot_remind");
    const trainingSummaryContext = trainingSummaryTask?.prompt ?? "";
    const hasTrainingSummaryContext = Boolean(trainingSummaryContext.trim());
    const shouldDiscardReply =
      previousReplyWasBootRemind && !hasTrainingSummaryContext;

    const prompt = buildRemindPrompt(messages, longTermMemory, trainingSummaryContext);

    if (!prompt.trim()) {
      console.log("[MikiAgent.remind] skipped: empty prompt", { durationMs: Date.now() - startedAt });
      return {
        status: "idle",
        text: "",
        error: null,
        messageId: null,
        meta: {
          source: "boot_remind",
        },
      };
    }

    const messageId = createMessageId("miki-remind");
    console.log("[MikiAgent.remind] running language turn", {
      durationMs: Date.now() - startedAt,
      messageId,
      shouldDiscardReply,
      hasTrainingSummaryContext,
    });
    // console.log("[MikiAgent.remind] running remind with prompt:", { prompt });

    const effectiveHandlers = shouldDiscardReply
      ? {
          ...handlers,
          onTextUpdate: () => {},
          onDone: () => {
            handlers.onTextUpdate?.("……");
            handlers.onDone?.("……");
          },
          onInterrupted: () => {
            handlers.onTextUpdate?.("……");
            handlers.onInterrupted?.("……");
          },
          onError: (err) => {
            handlers.onError?.(err, "……");
          },
        }
      : handlers;

    const turnResult = await runAgentTurn({
      inputText: prompt,
      messageId,
      handlers: effectiveHandlers,
      assistantMeta: {
        source: "boot_remind",
      },
      assistantRecordLabel: "memory.recordAssistantMessage(remind)",
      shouldRecordAssistantMessage: !shouldDiscardReply,
      shouldTouchMemory: true,
      languageOptions: {
        awaitDisplayDrain: false,
      },
    });

    console.log("[MikiAgent.remind] complete", {
      durationMs: Date.now() - startedAt,
      status: turnResult?.result?.status ?? "done",
      hasText: Boolean(turnResult?.assistantText ?? ""),
      messageId: shouldDiscardReply ? null : messageId,
      discarded: shouldDiscardReply,
    });

    return {
      status: turnResult?.result?.status ?? "done",
      text: shouldDiscardReply ? "" : turnResult?.assistantText ?? "",
      error: turnResult?.errorObj ?? null,
      messageId: shouldDiscardReply ? null : messageId,
      meta: {
        source: "boot_remind",
        discarded: shouldDiscardReply,
      },
    };
  }

  async function hear(input, handlers = {}) {
    const userText = typeof input === "string" ? input : input?.text ?? "";
    const messageId =
      typeof input === "string"
        ? createMessageId("miki")
        : input?.messageId ?? createMessageId("miki");
    const messageType =
      typeof input === "string"
        ? "user"
        : input?.messageType === "interaction" || input?.type === "interaction"
          ? "interaction"
          : "user";

    const trimmed = userText.trim();

    if (!trimmed) {
      return {
        status: "idle",
        text: "",
        error: null,
      };
    }

    setUserActive(messageType === "interaction" ? "interaction" : "chat_input");
    await ensureMemoryBooted();

    await safeCall(
      () => memory?.recordUserMessage?.(trimmed, {
        messageId,
        source: messageType === "interaction" ? "interaction" : null,
        messageType,
      }),
      null,
      "memory.recordUserMessage"
    );

    const turnResult = await runAgentTurn({
      inputText: trimmed,
      messageId,
      messageType,
      handlers,
      assistantMeta: {},
      assistantRecordLabel: "memory.recordAssistantMessage",
      shouldTouchMemory: false,
    });

    await safeCall(
      () =>
        memory?.rememberTurn?.({
          messageId,
          messageType,
          user: trimmed,
          assistant: turnResult?.assistantText ?? "",
          interrupted: Boolean(turnResult?.interrupted),
          hadError: Boolean(turnResult?.errorObj),
        }),
      null,
      "memory.rememberTurn"
    );

    return {
      status: turnResult?.result?.status ?? "done",
      text: turnResult?.assistantText ?? "",
      error: turnResult?.errorObj ?? null,
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

  async function start(handlers = {}) {
    // console.log("[MikiAgent.start] called with handlers:", handlers);
    const deferRemind = Boolean(handlers?.deferRemind);

    if (hasStarted) {
      emitBootPhase("ready", {}, handlers);
      return;
    }

    if (startPromise) return startPromise;

    startPromise = (async () => {
      emitBootPhase("archiving", {}, handlers);

      await ensureMemoryBooted();

      await safeCall(
        () => memory?.archiveStaleWakeCyclesIfNeeded?.(),
        null,
        "memory.archiveStaleWakeCyclesIfNeeded"
      );

      emitBootPhase("compacting", {}, handlers);

      await safeCall(
        () => memory?.compactLocalMemory?.(),
        null,
        "memory.compactLocalMemory(start)"
      );

      const recoverableMessages = await collectRecentMessagesForRemind(memory, 3);
      const hasRecoverableContext = recoverableMessages.length > 0;

      // console.log(
      //   "[MikiAgent.start]",
      //   "recoverableMessages =",
      //   recoverableMessages.length,
      //   "| action =",
      //   hasRecoverableContext
      //     ? deferRemind
      //       ? "defer_remind"
      //       : "boot_remind"
      //     : "skip_remind"
      // );

      let remindResult = {
        status: "idle",
        text: "",
        error: null,
      };

      if (hasRecoverableContext && !deferRemind) {
        emitBootPhase("reminding", {}, handlers);
        remindResult = await remind(handlers);
      }

      const bootSucceeded =
        deferRemind ||
        remindResult.status === "idle" ||
        remindResult.status === "done" ||
        remindResult.status === "interrupted";

      if (bootSucceeded) {
        hasStarted = true;
        emitBootPhase("ready", {}, handlers);
      } else {
        emitBootPhase("error", {
          error: remindResult.error ?? null,
        }, handlers);
      }

      return remindResult;
    })();

    try {
      return await startPromise;
    } finally {
      startPromise = null;
    }
  }

  function setStageProps(nextStageProps) {
    if (!nextStageProps) return;

    emitStageChange({
      ...getStageProps(),
      ...nextStageProps,
    });
  }

  function setStagePreset(presetKey) {
    if (presetKey === "normal" || presetKey === "magical") {
      externality?.setModelKey?.(presetKey);
    }
  }

  function resetStage() {
    externality?.patch?.({
      modelKey: initialStageProps?.modelKey ?? DEFAULT_STAGE_PROPS.modelKey,
      position: initialStageProps?.position ?? DEFAULT_STAGE_PROPS.position,
      scale: initialStageProps?.scale ?? DEFAULT_STAGE_PROPS.scale,
    });
  }

  function subscribeStage(listener) {
    return externality?.subscribeStage?.(listener) ?? (() => {});
  }

  function getStageProps() {
    return externality?.getState?.() ?? DEFAULT_STAGE_PROPS;
  }

  function setBattleModeActive(active) {
    const nextModelKey = active ? "magical" : "normal";
    emitStageChange({
      ...getStageProps(),
      modelKey: nextModelKey,
    });
  }

  function startTrainingRun(payload = {}) {
    setTrainingStatus("running", "idle");
    return memory?.startTrainingRun?.(payload) ?? null;
  }

  function endTrainingRun(runId = null, status = "finished") {
    setTrainingStatus("idle", "idle");
    return memory?.endTrainingRun?.(runId, status) ?? null;
  }

  function triggerIdlePresentation(source = "manual_idle") {
    const presentation = defaultPickIdlePresentation?.() ?? {};
    const motionId = presentation.motion ? motionMapper(presentation.motion) : null;
    const expressionId = presentation.expression
      ? emotionMapper(presentation.expression)
      : null;

    const expressionApplied = expressionId
      ? emotionEngine.setExpressionById(expressionId, {
          source: "idle",
          force: true,
        }) === true
      : false;
    const motionApplied = motionId
      ? emotionEngine.playMotionById(motionId, {
          source: "idle",
          force: true,
        }) === true
      : false;

    return {
      ok: expressionApplied || motionApplied,
      source,
      presentation,
      expressionId,
      motionId,
    };
  }

  async function handleLossUpdate(lossData) {
    return trainingCommentaryPipeline.handleLossUpdate(lossData);
  }

  function getDebugAPI() {
    return {
      hear,
      remind,
      start,
      interrupt,
      isBusy,
      getBootstrapMessages,

      touchMemory: (source = "debug") => touchMemory(source),
      clearLocalMemory: async () => memory?.clearLocalMemory?.(),
      importLocalMemory: async (nextDB) => memory?.importLocalMemory?.(nextDB),
      compactLocalMemory: async () => memory?.compactLocalMemory?.(),
      dumpMemory: async () => memory?.dump?.(),

      archiveStaleWakeCyclesIfNeeded: async () =>
        memory?.archiveStaleWakeCyclesIfNeeded?.(),

      subscribeBootPhase,
      getBootPhase,
      perceptionGateState: () => perceptionGate?.getState?.(),
      trainingStatus: () => trainingStatus,

      setUserActive,
      setUserIdle,
      setBattleModeActive,
      setStagePreset,
      resetStage,
      getStageProps,

      startTrainingRun,
      endTrainingRun,
      triggerIdlePresentation,
      handleLossUpdate,
      subscribeContactFeed,
    };
  }

  return {
    initialStageProps: getStageProps(),

    agent: {
      chat: {
        hear,
        sendMessage: hear,
        sendUserMessage: hear,
        remind,
        interrupt,
        isBusy,
        getBootstrapMessages,
        runPendingTrainingSummaryQuery,
      },

      app: {
        start,
        setMode,
        setUserActive,
        setUserIdle,
        notifyUserActivity: setUserActive,
        notifyUserIdle: setUserIdle,
        clearLocalMemory: () => memory?.clearLocalMemory?.(),
        importLocalMemory: (nextDB) => memory?.importLocalMemory?.(nextDB),
        compactLocalMemory: () => memory?.compactLocalMemory?.(),
        queueTrainingSummaryPrompt,
        hasPendingTrainingSummaryPrompt,
        subscribeBootPhase,
        getBootPhase,
      },

      battle: {
        startTrainingRun,
        endTrainingRun,
        triggerIdlePresentation,
        handleLossUpdate,
        submitLossData: handleLossUpdate,
        subscribeContactFeed,
        setTrainingSemantic: setTrainingStatus,
        interrupt,
      },

      stage: {
        subscribeStage,
        setStagePreset,
        setPreset: setStagePreset,
        getStageProps,
        resetStage,
        setStageProps,
      },

      getDebugAPI,
    },
  };
}
