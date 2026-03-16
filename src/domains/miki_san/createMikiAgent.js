// src/domains/miki_san/createMikiAgent.js

import { createCharacterRuntimeBridge } from "./motor/characterRuntimeBridge";
import { createCharacterOrchestrator } from "./motor/characterOrchestrator";
import { createLanguageModule } from "./language/languageModule";
import { emotionEngine } from "./body/emotionEngine";
import { emotionMapper } from "./motor/emotionMapper";
import { motionMapper } from "./motor/motionMapper";
import { createExternalityModule } from "./externality/createExternalityModule";
import { createPerceptionModule } from "./perception/perceptionModule.js";
import { createMemoryRuntime } from "./memory";

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

export function createMikiAgent({
  memory: injectedMemory = null,
  onExternalityChange = null,
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
  memory.boot();

  const perception = createPerceptionModule();

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

  const externality = createExternalityModule({
    initialModelKey: "normal",
    initialPosition: { x: 0.5, y: 0.85 },
    initialScale: 1.0,
    onChange: onExternalityChange,
  });

  let contactCallback = null;
  let lastPerceptionTime = 0;
  let lastPerceptionComment = null;
  let lastPerceptionFeature = null;

  const COOLDOWN_MS = 5000;

  function touchMemory() {
    if (typeof memory?.touch === "function") {
      memory.touch();
    }
  }

  function getStageProps() {
    return externality.getState();
  }

  function setAppMode(mode) {
    touchMemory();

    character.dispatch({
      type: "APP_MODE_CHANGED",
      mode,
    });
  }

  function setTrainingStatus(status = "idle", semantic = "idle") {
    if (semantic === "none") return;

    touchMemory();

    character.dispatch({
      type: "TRAINING_STATUS",
      payload: { status, semantic },
    });
  }

  function setUserActive(source = "app") {
    touchMemory();

    character.dispatch({
      type: "USER_ACTIVE",
      source,
    });
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

    await safeCall(
      () => memory?.recordUserMessage?.(trimmed, { messageId }),
      null,
      "memory.recordUserMessage"
    );

    const memoryContext = await safeCall(
      () => memory?.recall?.({ text: trimmed, messageId }),
      null,
      "memory.recall"
    );

    if (memoryContext && language?.remind) {
      await safeCall(
        () => language.remind(memoryContext),
        null,
        "language.remind"
      );
    }

    let latestAssistantText = "";
    let finalAssistantText = "";
    let interrupted = false;
    let errorObj = null;

    const wrappedHandlers = {
      ...handlers,

      onTextUpdate: (fullText) => {
        latestAssistantText = fullText ?? "";
        handlers.onTextUpdate?.(fullText);
      },

      onDone: (finalText) => {
        finalAssistantText = finalText ?? latestAssistantText ?? "";
        handlers.onDone?.(finalText);
      },

      onInterrupted: (partialText) => {
        interrupted = true;
        finalAssistantText = partialText ?? latestAssistantText ?? "";
        handlers.onInterrupted?.(partialText);
      },

      onError: (err, partialText) => {
        errorObj = err;
        finalAssistantText =
          partialText ?? latestAssistantText ?? finalAssistantText ?? "";
        handlers.onError?.(err, partialText);
      },
    };

    const result = await language.hear(
      {
        text: trimmed,
        messageId,
        memoryContext,
      },
      wrappedHandlers
    );

    const assistantText =
      (typeof result?.text === "string" && result.text) ||
      finalAssistantText ||
      latestAssistantText ||
      "";

    if (assistantText.trim()) {
      await safeCall(
        () =>
          memory?.recordAssistantMessage?.(assistantText, {
            messageId,
            interrupted,
            error: errorObj ? String(errorObj) : null,
          }),
        null,
        "memory.recordAssistantMessage"
      );
    }

    await safeCall(
      () =>
        memory?.rememberTurn?.({
          messageId,
          user: trimmed,
          assistant: assistantText,
          interrupted,
          hadError: Boolean(errorObj),
          memoryContext,
        }),
      null,
      "memory.rememberTurn"
    );

    return {
      ...result,
      text: assistantText,
    };
  }

  function registerContactCallback(cb) {
    contactCallback = cb;
  }

  function formatBattleCommentPrefix(timestamp, epoch) {
    const d = new Date(timestamp);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    const epochText = epoch != null ? `epoch ${epoch}` : "epoch ?";
    return `(${hh}:${mm}:${ss} || ${epochText})`;
  }

  async function onLossUpdate(lossData) {
    const now = Date.now();

    if (!lossData || lossData.length === 0) return null;
    if (now - lastPerceptionTime < COOLDOWN_MS) return null;

    const result = perception.comment(lossData);
    const { comment, feature, epoch } = result;

    if (!comment || feature === "none") return null;

    if (feature === lastPerceptionFeature || comment === lastPerceptionComment) {
      return null;
    }

    lastPerceptionTime = now;
    lastPerceptionFeature = feature;
    lastPerceptionComment = comment;

    setTrainingStatus("running", feature);

    const payload = {
      comment: `${formatBattleCommentPrefix(now, epoch)} ${comment}`,
      rawComment: comment,
      feature,
      epoch,
      timestamp: now,
    };

    await safeCall(
      () =>
        memory?.recordTrainingObservation?.({
          type: "perception_comment",
          feature,
          epoch,
          comment,
          timestamp: now,
        }),
      null,
      "memory.recordTrainingObservation"
    );

    if (contactCallback) {
      contactCallback(payload);
    }

    return payload;
  }

  function interrupt() {
    return language.interrupt();
  }

  function isBusy() {
    return language.isBusy?.() ?? false;
  }

  function getDebugAPI() {
    return {
      getCharacterState: () => character.getState?.(),
      dispatchCharacter: (event) => character.dispatch(event),

      getMemory: () => memory,
      dumpMemoryDB: () => memory?.dump?.(),

      resetMemoryDB: async () => {
        const mod = await import("./memory");
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
            onTextUpdate: (fullText) => console.log("[debug hear] full:", fullText),
            onDone: (finalText) => console.log("[debug hear] done:", finalText),
            onInterrupted: (partialText) =>
              console.log("[debug hear] interrupted:", partialText),
            onError: (err, partialText) =>
              console.error("[debug hear] error:", err, partialText),
          }
        );
      },

      interruptAgent: () => interrupt(),
      isAgentBusy: () => isBusy(),

      userActive: (source = "debug") => setUserActive(source),
      setCharacterMode: (nextMode) => setAppMode(nextMode),

      externality: {
        getState: () => externality.getState(),
        setModelKey: (modelKey) => externality.setModelKey(modelKey),
        setPosition: (position) => externality.setPosition(position),
        setScale: (scale) => externality.setScale(scale),
        patch: (partial) => externality.patch(partial),
        reset: () =>
          externality.patch({
            modelKey: "normal",
            position: { x: 0.5, y: 0.85 },
            scale: 1.0,
          }),
      },
    };
  }

  return {
    hear,
    interrupt,
    isBusy,
    memory,

    setAppMode,
    setTrainingStatus,
    setUserActive,

    getStageProps,
    getDebugAPI,

    externality,
    perception,
    onLossUpdate,
    registerContactCallback,
  };
}