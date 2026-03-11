import { pickIdleMotion } from "./idlePolicy";

function createInitialCharacterState() {
  return {
    appMode: "idle",

    activeIntent: null,

    chat: {
      streaming: false,
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
 // TODO: 这里的映射关系需要根据实际的表情设计来调整
 return "neutral";
}

function mapTrainingSemanticToMotion(semantic) {
 // TODO: 这里的映射关系需要根据实际的动作设计来调整
 return "idle_default";
}

function reduceState(state, event) {
  switch (event.type) {
    case "APP_MODE_CHANGED":
      return {
        ...state,
        appMode: event.mode,
      };

    case "CHAT_START":
      return {
        ...state,
        chat: {
          ...state.chat,
          streaming: true,
          lastTokenAt: Date.now(),
          pendingEmotion: null,
          pendingMotion: null,
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
          streaming: false,
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
  if (state.chat.streaming) {
    return makeIntent({
      source: "chat",
      priority: 100,
      emotion: state.chat.pendingEmotion || "speaking",
      motion: state.chat.pendingMotion || null,
      speech: true,
      interruptible: true,
    });
  }

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

  console.log("[CharacterIntent]", intent);
}

export function 


createCharacterOrchestrator({
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

    console.log("[CharacterEvent]", event);
    console.log("[CharacterState:before]", prevState);
    console.log("[CharacterState:after]", state);

    emit();
  }

  return {
    getState,
    subscribe,
    dispatch,
  };
}