// src/domains/miki_san/createMikiAgent.js

import { createCharacterRuntimeBridge } from "./motor/characterRuntimeBridge";
import { createCharacterOrchestrator } from "./motor/characterOrchestrator";
import { createLanguageModule } from "./language/languageModule";
import { emotionEngine } from "./body/emotionEngine";
import { emotionMapper } from "./motor/emotionMapper";
import { motionMapper } from "./motor/motionMapper";
import { createExternalityModule } from "./externality/createExternalityModule";
import { createPerceptionModule } from "./perception/perceptionModule.js";
import {
  createMemoryRuntime,
  listMessagesByWakeCycle,
  listRecentWakeCycles,
} from "./memory";

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

function formatDialogueRole(role) {
  if (role === "user") return "用户";
  if (role === "assistant") return "你";
  return "系统";
}

function formatPromptTime(ts) {
  if (!Number.isFinite(ts)) return "unknown";

  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");

  return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`;
}

function buildLongTermMemoryBlock(longTermMemory) {
  if (!longTermMemory) return "";

  const digestText = longTermMemory?.digest?.content?.trim?.() ?? "";

  const facts = Array.isArray(longTermMemory?.facts)
    ? longTermMemory.facts
    : [];

  const projects = Array.isArray(longTermMemory?.projects)
    ? longTermMemory.projects
    : [];

  const factLines = facts
    .slice(0, 8)
    .map((fact) => `- ${fact.value ?? ""}`.trim())
    .filter((line) => line !== "-");

  const projectLines = projects
    .slice(0, 5)
    .map((project) => {
      const title = project?.title ?? "";
      const summary = project?.summary ?? "";
      if (title && summary) return `- ${title}：${summary}`;
      if (title) return `- ${title}`;
      return "";
    })
    .filter(Boolean);

  const blocks = [];

  if (digestText) {
    blocks.push("【长期记忆摘要】");
    blocks.push(digestText);
  }

  if (factLines.length > 0) {
    blocks.push("【用户长期事实】");
    blocks.push(...factLines);
  }

  if (projectLines.length > 0) {
    blocks.push("【长期项目状态】");
    blocks.push(...projectLines);
  }

  return blocks.join("\n").trim();
}

function buildRemindPrompt(messages, longTermMemory = null) {
  const validMessages = (Array.isArray(messages) ? messages : [])
    .filter((msg) => typeof msg?.content === "string" && msg.content.trim())
    .slice(-200);

  const now = Date.now();

  const latestMessage =
    validMessages.length > 0 ? validMessages[validMessages.length - 1] : null;

  const lastTimestamp = Number.isFinite(latestMessage?.createdAt)
    ? latestMessage.createdAt
    : null;

  const dialogue = validMessages
    .map((msg) => {
      const role = formatDialogueRole(msg.role);
      const timeText = formatPromptTime(msg.createdAt);
      return `[${timeText}] ${role}：${msg.content.trim()}`;
    })
    .join("\n");

  const longTermBlock = buildLongTermMemoryBlock(longTermMemory);

  const parts = [
    "用户回来了，你开始回忆之前的对话内容。",
    `当前系统时间：${formatPromptTime(now)}`,
    `最近一条对话时间：${
      lastTimestamp ? formatPromptTime(lastTimestamp) : "unknown"
    }`,
  ];

  if (longTermBlock) {
    parts.push("你想起了用户的一些特质：");
    parts.push(longTermBlock);
  }

  if (dialogue) {
    parts.push("");
    parts.push("你又想起了之前的对话内容：");
    parts.push(dialogue);
  }

  parts.push(
    "",
    "与用户打个招呼作为开场白。",
    "如果只是刚离开半个小时以内，简短地打个招呼，一行以内即可",
    "如果已经离开了一段时间，就用更明显的“欢迎回来”语气，但也不要太长，两三句话即可。",
    "注意！不要显式包含本段提示词以及时间差的内容。",
    '示例：刚才干什么去啦？（如果用户刚离开）',
    '示例：嘿，我还在这呢，之前跟你说的那个核物理模型考虑的怎么样啦（如果用户离开了一段时间）',
  );

  return parts.join("\n");
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
  let bootRemindStarted = false;
  let bootRemindPromise = Promise.resolve({
    status: "idle",
    text: "",
    error: null,
  });

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

  async function remind(handlers = {}) {
    const recentWakeCycles = await safeCall(
      () => listRecentWakeCycles(3),
      [],
      "memory.listRecentWakeCycles"
    );

    console.log("[remind] recentWakeCycles raw:", recentWakeCycles);

    if (!Array.isArray(recentWakeCycles) || recentWakeCycles.length === 0) {
      console.log("[remind] no recent wake cycles");
      return {
        status: "idle",
        text: "",
        error: null,
      };
    }

    const orderedWakeCycles = [...recentWakeCycles].reverse();

    console.log(
      "[remind] orderedWakeCycles:",
      orderedWakeCycles.map((cycle) => ({
        id: cycle.id,
        startAt: cycle.startAt,
        endAt: cycle.endAt,
        status: cycle.status,
        lastActiveAt: cycle.lastActiveAt,
      }))
    );

    const messages = orderedWakeCycles.flatMap((cycle) => {
      const cycleMessages = listMessagesByWakeCycle(cycle.id);
      console.log(`[remind] messages in wakeCycle ${cycle.id}:`, cycleMessages);
      return cycleMessages;
    });

    messages.sort((a, b) => a.createdAt - b.createdAt);

    console.log(
      "[remind] merged messages:",
      messages.map((msg) => ({
        wakeCycleId: msg.wakeCycleId,
        role: msg.role,
        createdAt: msg.createdAt,
        content: msg.content?.slice(0, 60),
      }))
    );

    console.log(
      "[remind] unique wakeCycleIds in merged messages:",
      [...new Set(messages.map((msg) => msg.wakeCycleId))]
    );

    if (messages.length === 0) {
      console.log("[remind] merged messages empty");
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

    const prompt = buildRemindPrompt(messages, longTermMemory);

    console.log("[remind] longTermMemory:", longTermMemory);
    console.log("[remind] prompt preview:", prompt);
    
    if (!prompt.trim()) {
      console.log("[remind] prompt empty after buildRemindPrompt");
      return {
        status: "idle",
        text: "",
        error: null,
      };
    }

    const messageId = createMessageId("miki-remind");

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

    setUserActive("memory_remind");

    console.log("[remind] sending prompt to language.hear, messageId =", messageId);

    const result = await language.hear(
      {
        text: prompt,
        messageId,
      },
      wrappedHandlers
    );

    console.log("[remind] language.hear result:", result);

    const assistantText =
      (typeof result?.text === "string" && result.text) ||
      finalAssistantText ||
      latestAssistantText ||
      "";

    console.log("[remind] assistantText:", assistantText);

    if (assistantText.trim()) {
      await safeCall(
        () =>
          memory?.recordAssistantMessage?.(assistantText, {
            messageId,
            interrupted,
            error: errorObj ? String(errorObj) : null,
          }),
        null,
        "memory.recordAssistantMessage(remind)"
      );
    }

    return {
      ...result,
      text: assistantText,
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

    await safeCall(
      () => memory?.recordUserMessage?.(trimmed, { messageId }),
      null,
      "memory.recordUserMessage"
    );

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

  if (!bootRemindStarted) {
    bootRemindStarted = true;
    bootRemindPromise = Promise.resolve().then(() =>
      safeCall(
        () => remind(),
        {
          status: "error",
          text: "",
          error: new Error("boot remind failed"),
        },
        "agent.remindOnBoot"
      )
    );
  }

  return {
    hear,
    remind,
    interrupt,
    isBusy,
    memory,
    bootRemindPromise,

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