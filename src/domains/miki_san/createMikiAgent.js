import { createCharacterRuntimeBridge } from "./motor/characterRuntimeBridge";
import { createCharacterOrchestrator } from "./motor/characterOrchestrator";
import { createLanguageModule } from "./language/languageModule";
import { emotionEngine } from "./body/emotionEngine";
import { emotionMapper } from "./motor/emotionMapper";
import { motionMapper } from "./motor/motionMapper";
import { createExternalityModule } from "./externality/createExternalityModule";
import { createPerceptionModule } from "./perception/perceptionModule.js";
function createMessageId(prefix = "miki") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createMikiAgent({
  memory = null,
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
  
  const perception = createPerceptionModule();

  const language = createLanguageModule({
    onCharacterEvent: (event) => {
      character.dispatch(event);
    },
  });

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


  if (!character?.dispatch) {
    throw new Error("createMikiAgent: character.dispatch is required");
  }

  if (!language?.hear || !language?.interrupt) {
    throw new Error("createMikiAgent: language.hear and language.interrupt are required");
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
    if (semantic === "none") {
      return;
    }
    console.log("[MikiAgent] setTrainingStatus:", { status, semantic });
    character.dispatch({
      type: "TRAINING_STATUS",
      payload: { status, semantic },
    });
  }


  function setUserActive(source = "app") {
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

    character.dispatch({
      type: "USER_ACTIVE",
      source: "chat_input",
    });

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

    const result = await language.hear(
      {
        text: trimmed,
        messageId,
        memoryContext,
      },
      handlers
    );

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
    console.log("[onLossUpdate] perception result:", result);
    if (!comment || feature === "none") return null;

    // 去重
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

      beginChat: (messageId = "debug-chat") =>
        character.dispatch({
          type: "CHAT_BEGIN",
          messageId,
        }),

      startSpeaking: (messageId = "debug-chat") =>
        character.dispatch({
          type: "CHAT_SPEAK_START",
          messageId,
        }),

      token: (token = "debug token") =>
        character.dispatch({
          type: "CHAT_TOKEN",
          token,
        }),

      endChat: (messageId = "debug-chat") =>
        character.dispatch({
          type: "CHAT_END",
          messageId,
        }),

      setChatEmotion: (emotionKey) =>
        character.dispatch({
          type: "CHAT_CONTROL_EMOTION",
          value: emotionKey,
        }),

      setChatMotion: (motionKey) =>
        character.dispatch({
          type: "CHAT_CONTROL_MOTION",
          value: motionKey,
        }),

      setTraining: (status = "running", semantic = "normal") =>
        character.dispatch({
          type: "TRAINING_STATUS",
          payload: { status, semantic },
        }),

      userActive: (source = "debug") =>
        character.dispatch({
          type: "USER_ACTIVE",
          source,
        }),

      setCharacterMode: (nextMode) =>
        character.dispatch({
          type: "APP_MODE_CHANGED",
          mode: nextMode,
        }),

      demoThink: (messageId = "debug-chat") => {
        character.dispatch({
          type: "CHAT_BEGIN",
          messageId,
        });
      },

      demoSpeak: (messageId = "debug-chat") => {
        character.dispatch({
          type: "CHAT_SPEAK_START",
          messageId,
        });
      },

      demoLine: (
        {
          messageId = "debug-chat",
          emotion = null,
          motion = null,
        } = {}
      ) => {
        character.dispatch({
          type: "CHAT_BEGIN",
          messageId,
        });

        if (emotion) {
          character.dispatch({
            type: "CHAT_CONTROL_EMOTION",
            value: emotion,
          });
        }

        if (motion) {
          character.dispatch({
            type: "CHAT_CONTROL_MOTION",
            value: motion,
          });
        }

        character.dispatch({
          type: "CHAT_SPEAK_START",
          messageId,
        });
      },

      getLanguage: () => language,

      remindLanguage: (memoryContext) =>
        language.remind?.(memoryContext),

      hearLanguage: async (text, extra = {}) => {
        return language.hear(
          {
            text,
            messageId: extra.messageId ?? "debug-language",
            memoryContext: extra.memoryContext ?? null,
          },
          {
            onThinkingStart: () => console.log("[debug language] thinking"),
            onTextChunk: (chunk) => console.log("[debug language] chunk:", chunk),
            onTextUpdate: (fullText) =>
              console.log("[debug language] full:", fullText),
            onControl: (event) =>
              console.log("[debug language] control:", event),
            onDone: (finalText) =>
              console.log("[debug language] done:", finalText),
            onInterrupted: (partialText) =>
              console.log("[debug language] interrupted:", partialText),
            onError: (err, partialText) =>
              console.error("[debug language] error:", err, partialText),
            ...extra.handlers,
          }
        );
      },

      interruptLanguage: () => language.interrupt?.(),
      isLanguageBusy: () => language.isBusy?.(),

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