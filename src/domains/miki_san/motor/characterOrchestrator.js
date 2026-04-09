const DEFAULT_IDLE_MOTION_POOL = ["idle_default", "idle_relaxing"];
const DEFAULT_IDLE_EXPRESSION_POOL = ["smile", "calm_smile"];

const DEFAULT_TRAINING_INTENT_MAP = Object.freeze({
  rapid_drop: { emotion: "smile", motion: "assertive" },
  plateau: { emotion: "worried", motion: "idle_relaxing" },
  rebound: { emotion: "righteous_anger", motion: "anger" },
  stuck: { emotion: "focused", motion: "shy" },
  normal: { emotion: "neutral", motion: "idle_relaxing" },
  idle: { emotion: "neutral", motion: null },
  unknown: { emotion: "angry", motion: "idle_default" },
});

function pickRandom(items, fallback = null) {
  if (!Array.isArray(items) || items.length === 0) return fallback;
  const index = Math.floor(Math.random() * items.length);
  return items[index] ?? fallback;
}

function stampEvent(event = {}) {
  const now = Date.now();
  return {
    ...event,
    meta: {
      ...(event.meta ?? {}),
      now,
    },
  };
}

export function createInitialCharacterState(now = Date.now()) {
  return {
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
      active: false,
      lastUserActiveAt: now,
      startedAt: 0,
      motion: null,
      expression: null,
    },
  };
}

function createIntent({
  source,
  priority = 0,
  emotion = null,
  motion = null,
  speech = false,
  interruptible = true,
  durationMs = null,
  now = Date.now(),
}) {
  return {
    source,
    priority,
    emotion,
    motion,
    speech,
    interruptible,
    durationMs,
    createdAt: now,
  };
}

function createHoldIntent(prevIntent, now = Date.now()) {
  if (!prevIntent) return null;

  return createIntent({
    source: prevIntent.source,
    priority: prevIntent.priority,
    emotion: prevIntent.emotion ?? null,
    motion: prevIntent.motion ?? null,
    speech: false,
    interruptible: prevIntent.interruptible ?? true,
    durationMs: prevIntent.durationMs ?? null,
    now,
  });
}

/**
 * 把 training semantic -> 角色语义 映射抽成可注入 resolver。
 * 后面你如果想单独拆到 trainingPolicy.js，直接把这个 resolver 挪出去即可。
 */
export function createTrainingIntentResolver(intentMap = DEFAULT_TRAINING_INTENT_MAP) {
  return function resolveTrainingIntent({ training }) {
    const semantic = training?.semantic ?? "unknown";
    const mapped =
      intentMap[semantic] ??
      intentMap.unknown ?? {
        emotion: "angry",
        motion: "idle_default",
      };

    return {
      priority: 50,
      emotion: mapped.emotion ?? null,
      motion: mapped.motion ?? null,
      speech: false,
      interruptible: true,
    };
  };
}

export const defaultTrainingIntentResolver = createTrainingIntentResolver();

export function defaultPickIdlePresentation({
  idleMotionPool = DEFAULT_IDLE_MOTION_POOL,
  idleExpressionPool = DEFAULT_IDLE_EXPRESSION_POOL,
} = {}) {
  return {
    motion: pickRandom(idleMotionPool, null),
    expression: pickRandom(idleExpressionPool, null),
  };
}

/**
 * reduceState:
 * 只负责“事件如何更新状态”
 *
 * 不负责：
 * - 决定当前该播什么 intent
 * - 做 mapper 映射
 * - 生成随机 idle 动作/表情
 * - 触发任何 runtime side effect
 */
export function reduceState(state, event) {
  const now = event?.meta?.now ?? Date.now();

  switch (event?.type) {
    case "APP_MODE_CHANGED":
      // 兼容旧调用方；当前 orchestrator 已不再消费 appMode。
      return state;

    case "CHAT_BEGIN":
      return {
        ...state,
        chat: {
          ...state.chat,
          active: true,
          speaking: false,
          lastTokenAt: now,
          pendingEmotion: null,
          pendingMotion: null,
        },
        idle: {
          ...state.idle,
          active: false,
          startedAt: 0,
          motion: null,
          expression: null,
        },
      };

    case "CHAT_SPEAK_START":
      return {
        ...state,
        chat: {
          ...state.chat,
          active: true,
          speaking: true,
          lastTokenAt: now,
        },
        idle: {
          ...state.idle,
          active: false,
          startedAt: 0,
          motion: null,
          expression: null,
        },
      };

    case "CHAT_SPEAK_STOP":
      return {
        ...state,
        chat: {
          ...state.chat,
          active: true,
          speaking: false,
          lastTokenAt: now,
        },
      };

    case "CHAT_TOKEN":
      return {
        ...state,
        chat: {
          ...state.chat,
          lastTokenAt: now,
        },
      };

    case "CHAT_CONTROL_EMOTION":
      return {
        ...state,
        chat: {
          ...state.chat,
          pendingEmotion: event.value ?? null,
          lastTokenAt: now,
        },
      };

    case "CHAT_CONTROL_MOTION":
      return {
        ...state,
        chat: {
          ...state.chat,
          pendingMotion: event.value ?? null,
          lastTokenAt: now,
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
          active: false,
          startedAt: 0,
          motion: null,
          expression: null,
        },
      };

    case "TRAINING_STATUS": {
      const nextStatus = event.payload?.status ?? "idle";
      const nextSemantic = event.payload?.semantic ?? "idle";

      return {
        ...state,
        training: {
          status: nextStatus,
          semantic: nextSemantic,
        },
        idle: {
          ...state.idle,
          active: false,
          startedAt: 0,
          motion: null,
          expression: null,
        },
      };
    }

    case "USER_ACTIVE":
      return {
        ...state,
        idle: {
          ...state.idle,
          lastUserActiveAt: now,
          active: false,
          startedAt: 0,
          motion: null,
          expression: null,
        },
      };

    case "IDLE_ENTER":
      if (!state.idle.enabled) return state;
      if (state.chat.active) return state;
      if (state.training.status === "running") return state;

      return {
        ...state,
        idle: {
          ...state.idle,
          active: true,
          startedAt: now,
          motion: event.payload?.motion ?? null,
          expression: event.payload?.expression ?? null,
        },
      };

    default:
      return state;
  }
}

/**
 * resolveIntent:
 * 只负责“从当前状态推导当前想呈现什么 intent”
 *
 * 不负责：
 * - 修改 state
 * - 触发 runtime side effect
 * - 安排 idle 定时器
 * - 生成随机 idle 候选
 */
export function resolveIntent(
  state,
  prevIntent,
  { trainingIntentResolver = defaultTrainingIntentResolver } = {}
) {
  const now = Date.now();

  if (state.chat.active && state.chat.speaking) {
    return createIntent({
      source: "chat",
      priority: 100,
      emotion: state.chat.pendingEmotion || "speaking",
      motion: state.chat.pendingMotion || null,
      speech: true,
      interruptible: true,
      now,
    });
  }

  if (state.chat.active && !state.chat.speaking) {
    return createIntent({
      source: "chat",
      priority: 100,
      emotion: state.chat.pendingEmotion || "focused",
      motion: state.chat.pendingMotion || "shy",
      speech: false,
      interruptible: true,
      now,
    });
  }

  if (state.training.status === "running") {
    const trainingIntent =
      trainingIntentResolver?.({
        training: state.training,
        state,
        prevIntent,
      }) ?? {};

    return createIntent({
      source: "training",
      priority: trainingIntent.priority ?? 50,
      emotion: trainingIntent.emotion ?? null,
      motion: trainingIntent.motion ?? null,
      speech: trainingIntent.speech ?? false,
      interruptible: trainingIntent.interruptible ?? true,
      durationMs: trainingIntent.durationMs ?? null,
      now,
    });
  }

  if (state.idle.active && (state.idle.expression || state.idle.motion)) {
    return createIntent({
      source: "idle",
      priority: 10,
      emotion: state.idle.expression ?? null,
      motion: state.idle.motion ?? null,
      speech: false,
      interruptible: true,
      now,
    });
  }

  /**
   * 没有新的强语义来源时，保留上一帧外观，只关嘴。
   * 这样角色不会突然抽回默认态。
   */
  if (prevIntent && (prevIntent.emotion || prevIntent.motion)) {
    return createHoldIntent(prevIntent, now);
  }

  return createIntent({
    source: "baseline",
    priority: 0,
    emotion: "neutral",
    motion: null,
    speech: false,
    interruptible: true,
    now,
  });
}

export function isSameIntent(a, b) {
  if (!a || !b) return false;

  return (
    a.source === b.source &&
    a.priority === b.priority &&
    a.emotion === b.emotion &&
    a.motion === b.motion &&
    a.speech === b.speech &&
    a.interruptible === b.interruptible &&
    a.durationMs === b.durationMs
  );
}

function applyIntent(
  intent,
  prevIntent,
  { runtimeBridge, emotionMapper, motionMapper }
) {
  const emotionChanged = !prevIntent || intent.emotion !== prevIntent.emotion;
  const motionChanged = !prevIntent || intent.motion !== prevIntent.motion;
  const speechChanged = !prevIntent || intent.speech !== prevIntent.speech;

  if (emotionChanged && intent.emotion != null) {
    const mappedEmotion =
      typeof emotionMapper === "function"
        ? emotionMapper(intent.emotion)
        : intent.emotion;

    if (mappedEmotion != null) {
      runtimeBridge.apply({
        type: "SET_EMOTION",
        value: mappedEmotion,
      });
    }
  }

  if (motionChanged && intent.motion != null) {
    const mappedMotion =
      typeof motionMapper === "function"
        ? motionMapper(intent.motion)
        : intent.motion;

    if (mappedMotion != null) {
      runtimeBridge.apply({
        type: "PLAY_MOTION",
        value: mappedMotion,
      });
    }
  }

  if (speechChanged) {
    runtimeBridge.apply({
      type: intent.speech ? "SET_SPEECH" : "STOP_SPEECH",
    });
  }
}

export function createCharacterOrchestrator({
  runtimeBridge,
  emotionMapper,
  motionMapper,
  idleDelayMs = 4000,
  idleMotionPool = DEFAULT_IDLE_MOTION_POOL,
  idleExpressionPool = DEFAULT_IDLE_EXPRESSION_POOL,
  pickIdlePresentation = defaultPickIdlePresentation,
  trainingIntentResolver = defaultTrainingIntentResolver,
} = {}) {
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
      try {
        listener(state);
      } catch (err) {
        console.error("[CharacterOrchestrator] listener error:", err);
      }
    }
  }

  function clearIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  /**
   * 只有在：
   * - 未处于 chat
   * - 未处于 training running
   * - 当前还没进入 idle
   * 的情况下，才根据“距离上次 USER_ACTIVE 的时间”安排 idle。
   */
  function scheduleIdleIfNeeded() {
    clearIdleTimer();

    if (!state.idle.enabled) return;
    if (state.idle.active) return;
    if (state.chat.active) return;
    if (state.training.status === "running") return;

    const now = Date.now();
    const inactiveForMs = now - state.idle.lastUserActiveAt;
    const waitMs = Math.max(0, idleDelayMs - inactiveForMs);

    idleTimer = setTimeout(() => {
      if (!state.idle.enabled) return;
      if (state.idle.active) return;
      if (state.chat.active) return;
      if (state.training.status === "running") return;

      const presentation =
        pickIdlePresentation?.({
          state,
          idleMotionPool,
          idleExpressionPool,
        }) ?? {};

      dispatch({
        type: "IDLE_ENTER",
        payload: {
          motion: presentation.motion ?? null,
          expression: presentation.expression ?? null,
        },
      });
    }, waitMs);
  }

  function dispatch(event = {}) {
    const prevIntent = state.activeIntent;
    const nextEvent = stampEvent(event);

    state = reduceState(state, nextEvent);

    const nextIntent = resolveIntent(state, prevIntent, {
      trainingIntentResolver,
    });

    if (!isSameIntent(prevIntent, nextIntent)) {
      applyIntent(nextIntent, prevIntent, {
        runtimeBridge,
        emotionMapper,
        motionMapper,
      });
    }

    state = {
      ...state,
      activeIntent: nextIntent,
    };

    emit();
    scheduleIdleIfNeeded();
  }

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