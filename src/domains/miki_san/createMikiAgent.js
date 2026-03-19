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

const DEFAULT_STAGE_PROPS = {
  modelKey: "normal",
  position: { x: 0.5, y: 0.85 },
  scale: 1.0,
};

function createMessageId(prefix = "miki") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

export function createMikiAgent({
  onStageChange = null,
  initialStageProps = DEFAULT_STAGE_PROPS,
} = {}) {
  const externality = createExternalityModule({
    initialStageProps,
    onStageChange,
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

  let trainingStatus = {
    status: "idle",
    semantic: "idle",
  };

  function emitStageChange(nextStageProps) {
    externality?.setStageProps?.(nextStageProps);
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
    handlers = {},
    assistantMeta = {},
    assistantRecordLabel = "memory.recordAssistantMessage",
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
            error: turn?.errorObj ? String(turn.errorObj) : null,
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
    console.log("[MikiAgent.remind] running remind with prompt:", { prompt });

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

    console.log("[MikiAgent.remind] finished reminding");

    return {
      status: turnResult?.result?.status ?? "done",
      text: turnResult?.assistantText ?? "",
      error: turnResult?.errorObj ?? null,
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
    if (hasStarted) {
      emitBootPhase(handlers, "ready");
      return;
    }

    if (startPromise) return startPromise;

    startPromise = (async () => {
      emitBootPhase(handlers, "archiving");

      await ensureMemoryBooted();

      await safeCall(
        () => memory?.archiveStaleWakeCyclesIfNeeded?.(),
        null,
        "memory.archiveStaleWakeCyclesIfNeeded"
      );

      emitBootPhase(handlers, "compacting");

      await safeCall(
        () => memory?.compactLocalMemory?.(),
        null,
        "memory.compactLocalMemory(start)"
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
        remindResult = await remind(handlers);
      }

      const bootSucceeded =
        remindResult.status === "idle" ||
        remindResult.status === "done" ||
        remindResult.status === "interrupted";

      if (bootSucceeded) {
        hasStarted = true;
        emitBootPhase(handlers, "ready");
      } else {
        emitBootPhase(handlers, "error", {
          error: remindResult.error ?? null,
        });
      }

      return remindResult;
    })();

    try {
      return await startPromise;
    } finally {
      startPromise = null;
    }
  }

  function setStagePreset(preset) {
    externality?.setStagePreset?.(preset);
  }

  function resetStage() {
    externality?.resetStage?.();
  }

  function subscribeStage(listener) {
    return externality?.subscribeStage?.(listener) ?? (() => {});
  }

  function getStageProps() {
    return externality?.getStageProps?.() ?? DEFAULT_STAGE_PROPS;
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
      compactLocalMemory: async () => memory?.compactLocalMemory?.(),
      dumpMemory: async () => memory?.dump?.(),

      archiveStaleWakeCyclesIfNeeded: async () =>
        memory?.archiveStaleWakeCyclesIfNeeded?.(),

      perceptionGateState: () => perceptionGate?.getState?.(),
      trainingStatus: () => trainingStatus,

      setUserActive,
      setBattleModeActive,
      setStagePreset,
      resetStage,
      getStageProps,

      startTrainingRun,
      endTrainingRun,
      handleLossUpdate,
    };
  }

  return {
    initialStageProps: getStageProps(),

    agent: {
      chat: {
        hear,
        remind,
        interrupt,
        isBusy,
        getBootstrapMessages,
      },

      app: {
        start,
        setUserActive,
        clearLocalMemory: () => memory?.clearLocalMemory?.(),
        compactLocalMemory: () => memory?.compactLocalMemory?.(),
      },

      battle: {
        startTrainingRun,
        endTrainingRun,
        handleLossUpdate,
      },

      stage: {
        subscribeStage,
        setStagePreset,
        resetStage,
        getStageProps,
      },

      getDebugAPI,
    },
  };
}