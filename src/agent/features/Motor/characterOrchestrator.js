import { pickIdleMotion } from "./idlePolicy";

function createInitialCharacterState() {
  return {
    appMode: "chat",

    activeIntent: null,

    chat: {
      active: false,
      speaking: false,
      lastTokenAt: 0,
      pendingEmotion: null,
      pendingMotion: null,
    },

    training: {
      status: "idle",
      semantic: "idle",
    },

    idle: {
      enabled: true,
      lastActiveAt: Date.now(),
    },
  };
}

function makeIntent({
  source,
  priority = 0,
  emotion = null,
  motion = null,
  speech = false,
  interruptible = true,
  durationMs = null,
}) {
  return {
    source,
    priority,
    emotion,
    motion,
    speech,
    interruptible,
    durationMs,
    createdAt: Date.now(),
  };
}

function mapTrainingSemanticToEmotion(semantic) {
  switch (semantic) {
    case "focused":
    case "stable":
    case "running":
      return "focused";

    case "smile":
    case "completed":
    case "success":
      return "smile";

    case "worried":
    case "unstable":
    case "plateau":
      return "worried";

    case "angry":
    case "diverging":
    case "error":
      return "angry";

    case "idle":
    default:
      return "neutral";
  }
}

function mapTrainingSemanticToMotion(semantic) {
  switch (semantic) {
    case "focused":
    case "stable":
    case "running":
      return "assertive";

    case "smile":
    case "completed":
    case "success":
      return "excited";

    case "angry":
    case "diverging":
    case "error":
      return "angry";

    case "worried":
    case "unstable":
    case "plateau":
      return "confident";

    case "idle":
    default:
      return "idle_default";
  }
}

function reduceState(state, event) {
  switch (event.type) {
    case "APP_MODE_CHANGED":
      return {
        ...state,
        appMode: event.mode,
      };

    case "CHAT_BEGIN":
      return {
        ...state,
        chat: {
          ...state.chat,
          active: true,
          speaking: false,
          lastTokenAt: Date.now(),
          // 进入思考阶段时清空上一轮缓存
          pendingEmotion: null,
          pendingMotion: null,
        },
        idle: {
          ...state.idle,
          lastActiveAt: Date.now(),
        },
      };

    case "CHAT_SPEAK_START":
      return {
        ...state,
        chat: {
          ...state.chat,
          active: true,
          speaking: true,
          lastTokenAt: Date.now(),
        },
        idle: {
          ...state.idle,
          lastActiveAt: Date.now(),
        },
      };

    case "CHAT_TOKEN":
      return {
        ...state,
        chat: {
          ...state.chat,
          lastTokenAt: Date.now(),
        },
        idle: {
          ...state.idle,
          lastActiveAt: Date.now(),
        },
      };

    case "CHAT_CONTROL_EMOTION":
      return {
        ...state,
        chat: {
          ...state.chat,
          pendingEmotion: event.value,
          lastTokenAt: Date.now(),
        },
      };

    case "CHAT_CONTROL_MOTION":
      return {
        ...state,
        chat: {
          ...state.chat,
          pendingMotion: event.value,
          lastTokenAt: Date.now(),
        },
      };

    case "CHAT_END":
      return {
        ...state,
        chat: {
          ...state.chat,
          active: false,
          speaking: false,
          // 不清空 pending 也可以，但这里建议清空，避免下一轮串味
          pendingEmotion: null,
          pendingMotion: null,
        },
      };

    case "TRAINING_STATUS":
      return {
        ...state,
        training: {
          status: event.payload?.status ?? "idle",
          semantic: event.payload?.semantic ?? "idle",
        },
      };

    case "USER_ACTIVE":
      return {
        ...state,
        idle: {
          ...state.idle,
          lastActiveAt: Date.now(),
        },
      };

    default:
      return state;
  }
}

function resolveIntent(state) {
  // 1. chat 思考阶段：固定思考动作，不吃缓存
  if (state.chat.active && !state.chat.speaking) {
    return makeIntent({
      source: "chat",
      priority: 100,
      emotion: "focused", // <<emotion:focused>>
      motion: "shy",      // <<motion:shy>>
      speech: false,
      interruptible: true,
    });
  }

  // 2. chat 说话阶段：先吃缓存，之后继续吃后续控制符
  if (state.chat.active && state.chat.speaking) {
    return makeIntent({
      source: "chat",
      priority: 100,
      emotion: state.chat.pendingEmotion || "speaking",
      motion: state.chat.pendingMotion || null,
      speech: true,
      interruptible: true,
    });
  }

  // 3. training
  if (state.training.status === "running") {
    return makeIntent({
      source: "training",
      priority: 50,
      emotion: mapTrainingSemanticToEmotion(state.training.semantic),
      motion: mapTrainingSemanticToMotion(state.training.semantic),
      speech: false,
      interruptible: true,
    });
  }

  // 4. idle
  return makeIntent({
    source: "idle",
    priority: 10,
    emotion: "neutral",
    motion: pickIdleMotion(state),
    speech: false,
    interruptible: true,
  });
}

function isSameIntent(a, b) {
  if (!a || !b) return false;
  return (
    a.source === b.source &&
    a.priority === b.priority &&
    a.emotion === b.emotion &&
    a.motion === b.motion &&
    a.speech === b.speech &&
    a.interruptible === b.interruptible
  );
}

function applyIntent(intent, { runtimeBridge, emotionMapper, motionMapper }) {
  if (intent.emotion) {
    runtimeBridge.apply({
      type: "SET_EMOTION",
      value: emotionMapper(intent.emotion),
    });
  }

  if (intent.motion) {
    runtimeBridge.apply({
      type: "PLAY_MOTION",
      value: motionMapper(intent.motion),
    });
  }

  if (intent.speech) {
    runtimeBridge.apply({
      type: "SET_SPEECH",
    });
  } else {
    runtimeBridge.apply({
      type: "STOP_SPEECH",
    });
  }

  console.log(
    "[CharacterIntent]",
    intent.source,
    "emotion=",
    intent.emotion,
    "motion=",
    intent.motion,
    "speech=",
    intent.speech
  );
}

export function createCharacterOrchestrator({
  runtimeBridge,
  emotionMapper,
  motionMapper,
}) {
  let state = createInitialCharacterState();
  const listeners = new Set();

  function getState() {
    return state;
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function emit() {
    for (const listener of listeners) {
      listener(state);
    }
  }

  function dispatch(event) {
    const prevState = state;
    const prevIntent = state.activeIntent;

    state = reduceState(state, event);
    const nextIntent = resolveIntent(state);

    if (!isSameIntent(prevIntent, nextIntent)) {
      applyIntent(nextIntent, {
        runtimeBridge,
        emotionMapper,
        motionMapper,
      });
    }

    state = {
      ...state,
      activeIntent: nextIntent,
    };
    // 如果是CHAT_TOKEN事件，不更新log
    if (!event.type === "CHAT_TOKEN") {
    console.log(
      "[CharacterEvent]",
      event.type,
      event.value ?? "",
      event.messageId ?? "",
      event.token ?? ""
    );
    console.log("[CharacterState:before]", prevState);
    console.log("[CharacterState:after]", state);
  }
    

    emit();
  }

  return {
    getState,
    subscribe,
    dispatch,
  };
}