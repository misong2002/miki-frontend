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
      active: true,
      lastActiveAt: Date.now(),
      motion: null,
      expression: null,
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

function pickIdleMotion() {
  return Math.random() < 0.5 ? "idle_default" : "idle_relaxing";
}

function pickIdleExpression() {
  return Math.random() < 0.8 ? "smile" : "neutral";
}

// 修改下面的映射实现这个映射
// // perception/motorMapping.js

// /**
//  * 根据 loss 特征映射到 character 的表情和动作
//  * @param {string} feature - loss 特征
//  * @returns {{emotion: string, motion: string}}
//  */
// export function mapMotorInstruction(feature) {
//   switch (feature) {
//     case "rapid_drop":
//       return { emotion: "smile", motion: "excited" };
//     case "plateau":
//       return { emotion: "worried", motion: "idle_relaxing" };
//     case "rebound":
//       return { emotion: "righteous_anger", motion: "anger" };
//     case "stuck":
//       return { emotion: "focused", motion: "shy" };
//     default:
//       return { emotion: "angry", motion: "idle_default" };
//   }
// }

function mapTrainingSemanticToEmotion(semantic) {
  switch (semantic) {
    case 'rapid_drop':
      return 'smile';
    case 'plateau':
      return 'worried';
    case 'rebound':
      return 'righteous_anger';
    case 'stuck':
      return 'focused';
    case 'normal':
      return 'neutral';
    default:
      return 'angry';
  }
}

function mapTrainingSemanticToMotion(semantic) {
  switch (semantic) {
    case 'rapid_drop':
      return 'assertive';
    case 'plateau':
      return 'idle_relaxing';
    case 'rebound':
      return 'anger';
    case 'stuck':
      return 'shy';
    case 'normal':
      return 'idle_relaxing';
    default:
      return 'idle_default';
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
          pendingEmotion: null,
          pendingMotion: null,
        },
        idle: {
          ...state.idle,
          active: false,
          motion: null,
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
          active: false,
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
            pendingEmotion: null,
            pendingMotion: null,
          },
          idle: {
            ...state.idle,
            active: true,
            motion: null,   // 关键：这里必须清空
            expression: null,
            lastActiveAt: Date.now(),
          },
        };
    case "TRAINING_STATUS": {
      const nextStatus = event.payload?.status ?? "idle";
      const nextSemantic = event.payload?.semantic ?? "idle";
      const trainingRunning = nextStatus === "running";

      return {
        ...state,
        training: {
          status: nextStatus,
          semantic: nextSemantic,
        },
        idle: {
          ...state.idle,
          active: !trainingRunning && !state.chat.active,
          motion: trainingRunning ? null : state.idle.motion,
          expression: trainingRunning ? null : state.idle.expression,
          lastActiveAt: Date.now(),
        },
      };
    }

    case "USER_ACTIVE":
      return {
        ...state,
        idle: {
          ...state.idle,
          lastActiveAt: Date.now(),
        },
      };

    case "IDLE_TICK":
      if (!state.idle.enabled) return state;
      if (state.chat.active) return state;
      if (state.training.status === "running") return state;

      return {
        ...state,
        idle: {
          ...state.idle,
          active: true,
          motion: pickIdleMotion(),
          lastActiveAt: Date.now(),
          expression: pickIdleExpression(),
        },
      };

    default:
      return state;
  }
}

  function resolveIntent(state, prevIntent) {
    if (state.chat.active && !state.chat.speaking) {
      return makeIntent({
        source: "chat",
        priority: 100,
        emotion: "focused",
        motion: "shy",
        speech: false,
        interruptible: true,
      });
    }

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

    // 只有 idle tick 真正给了动作，才进入 idle intent
    if (state.idle.active && state.idle.motion) {
      return makeIntent({
        source: "idle",
        priority: 10,
        emotion: "smile",
        motion: state.idle.motion,
        speech: false,
        interruptible: true,
      });
    }

    // 关键：默认保留上一帧表情/动作，只关嘴
    if (prevIntent) {
      return {
        ...prevIntent,
        speech: false,
      };
    }

    return makeIntent({
      source: "idle",
      priority: 10,
      emotion: "smile",
      motion: null,
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

function applyIntent(intent, prevIntent, { runtimeBridge, emotionMapper, motionMapper }) {
  const emotionChanged = !prevIntent || intent.emotion !== prevIntent.emotion;
  const motionChanged = !prevIntent || intent.motion !== prevIntent.motion;
  const speechChanged = !prevIntent || intent.speech !== prevIntent.speech;

  if (emotionChanged && intent.emotion) {
    runtimeBridge.apply({
      type: "SET_EMOTION",
      value: emotionMapper(intent.emotion),
    });
  }

  if (motionChanged && intent.motion) {
    runtimeBridge.apply({
      type: "PLAY_MOTION",
      value: motionMapper(intent.motion),
    });
  }

  if (speechChanged) {
    runtimeBridge.apply({
      type: intent.speech ? "SET_SPEECH" : "STOP_SPEECH",
    });
  }

  // console.log(
  //   "[CharacterIntent]",
  //   intent.source,
  //   "emotion=",
  //   intent.emotion,
  //   "motion=",
  //   intent.motion,
  //   "speech=",
  //   intent.speech
  // );
}
export function createCharacterOrchestrator({
  runtimeBridge,
  emotionMapper,
  motionMapper,
  idleIntervalMs = 4000,
}) {
  let state = createInitialCharacterState();
  const listeners = new Set();

  let idleTimer = null;

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

  function clearIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function scheduleIdleIfNeeded() {
    clearIdleTimer();

    if (!state.idle.enabled) return;
    if (state.chat.active) return;
    if (state.training.status === "running") return;

    idleTimer = setTimeout(() => {
      dispatch({ type: "IDLE_TICK" });
    }, idleIntervalMs);
  }

  function dispatch(event) {
    const prevState = state;
    const prevIntent = state.activeIntent;

    state = reduceState(state, event);
    const nextIntent = resolveIntent(state, prevIntent);

    if (!isSameIntent(prevIntent, nextIntent)) {
      applyIntent(nextIntent,prevIntent, {
        runtimeBridge,
        emotionMapper,
        motionMapper,
      });
    }

    state = {
      ...state,
      activeIntent: nextIntent,
    };

    // console.log(
    //   "[CharacterEvent]",
    //   { time: Date.now() },
    //   event.type,
    //   event.value ?? "",
    //   event.messageId ?? "",
    //   event.token ?? ""
    // );
    // console.log("[CharacterState:before]", prevState);
    // console.log("[CharacterState:after]", state);

    emit();
    scheduleIdleIfNeeded();
  }

  // 初始化后就开始 idle 调度
  scheduleIdleIfNeeded();

  return {
    getState,
    subscribe,
    dispatch,
    destroy() {
      clearIdleTimer();
      listeners.clear();
    },
  };
}