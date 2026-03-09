import { SAYAKA_BEHAVIOR } from "./sayakaBehaviorMap";
import { live2dController } from "./live2dController";
const DEBUG_EMOTION_ENGINE = true;
const SOURCE_PRIORITY = {
  idle: 1,
  battle: 2,
  typing: 3,
  llm: 4,
  interrupt: 5,
};

const DEFAULT_LOCK_MS = {
  idle: 1200,
  battle: 1500,
  typing: 800,
  llm: 1800,
  interrupt: 2200,
};

class EmotionEngine {
  constructor() {
    this.mode = "chat"; // chat | battle
    this.current = {
      emotion: "neutral",
      motion: "000",
      source: "idle",
      priority: SOURCE_PRIORITY.idle,
      lockUntil: 0,
    };

    this.idleTimer = null;
    this.idleDelayMs = 5000;
    this.listeners = new Set();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event) {
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch (err) {
        console.error("[EmotionEngine] listener error:", err);
      }
    }
  }

  setMode(mode) {
    this.mode = mode;
    this.emit({ type: "mode", mode });
  }

  now() {
    return Date.now();
  }

  getPriority(source) {
    return SOURCE_PRIORITY[source] ?? 0;
  }

  getLockMs(source, override) {
    if (typeof override === "number") return override;
    return DEFAULT_LOCK_MS[source] ?? 1000;
  }

  canApply(source, force = false) {
    if (force) return true;

    const now = this.now();
    const nextPriority = this.getPriority(source);

    if (now >= this.current.lockUntil) {
      return true;
    }

    return nextPriority > this.current.priority;
  }

  applyBehavior({ emotion, motion = null, source = "idle", lockMs, force = false }) {
    const behavior = SAYAKA_BEHAVIOR[emotion];
    if (!behavior) {
      console.warn("[EmotionEngine] unknown emotion:", emotion);
      return false;
    }

    if (!this.canApply(source, force)) {
      return false;
    }

    const finalMotion = motion ?? behavior.motion;
    const finalExpression = behavior.expression;

    live2dController.setExpressionById(finalExpression);
    live2dController.playMotionById(finalMotion);

    this.current = {
      emotion,
      motion: finalMotion,
      source,
      priority: this.getPriority(source),
      lockUntil: this.now() + this.getLockMs(source, lockMs),
    };

    this.emit({
      type: "apply",
      mode: this.mode,
      emotion,
      motion: finalMotion,
      source,
      expression: finalExpression,
      state: { ...this.current },
    });

    return true;
  }

  requestEmotion(emotion, options = {}) {
    this.log("REQUEST_EMOTION", {
    source: options.source ?? "unknown",
    emotion,
    motion: options.motion ?? null,
    current: this.current
    });
    
    this.log("REQUEST_MOTION", {
    source: options.source ?? "unknown",
    motion,
    current: this.current
    });
    return this.applyBehavior({
      emotion,
      source: options.source ?? "idle",
      motion: options.motion ?? null,
      lockMs: options.lockMs,
      force: options.force ?? false,
    });
  }

  requestMotion(motion, options = {}) {
    const emotion = options.emotion ?? this.current.emotion ?? "neutral";
    return this.applyBehavior({
      emotion,
      motion,
      source: options.source ?? "idle",
      lockMs: options.lockMs,
      force: options.force ?? false,
    });
  }

  interrupt() {
    return this.applyBehavior({
      emotion: "surprised",
      motion: "100",
      source: "interrupt",
      lockMs: 2200,
      force: true,
    });
  }

  setTypingState(kind = "thinking") {
    if (kind === "thinking") {
      return this.requestEmotion("thinking", {
        source: "typing",
        motion: "200",
        lockMs: 100,
      });
    }

    if (kind === "speaking") {
      return this.requestEmotion("explaining", {
        source: "typing",
        motion: "201",
        lockMs: 1000,
      });
    }

    return false;
  }

  setBattleState(kind) {
    const mapping = {
      stable: { emotion: "neutral", motion: "000" },
      focused: { emotion: "explaining", motion: "201" },
      drop: { emotion: "happy", motion: "400" },
      oscillating: { emotion: "thinking", motion: "200" },
      diverging: { emotion: "angry", motion: "300" },
      warning: { emotion: "worried", motion: "200" },
      righteous: { emotion: "righteous", motion: "201" },
    };

    const target = mapping[kind];
    if (!target) return false;

    return this.requestEmotion(target.emotion, {
      source: "battle",
      motion: target.motion,
      lockMs: 1800,
    });
  }

  scheduleIdle() {
    this.clearIdle();

    this.idleTimer = setTimeout(() => {
      this.runIdleBehavior();
    }, this.idleDelayMs);
  }

  clearIdle() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  notifyUserActivity() {
    this.clearIdle();
    this.scheduleIdle();
  }

  runIdleBehavior() {
    const candidates =
      this.mode === "battle"
        ? [
            { emotion: "thinking", motion: "200" },
            { emotion: "neutral", motion: "000" },
            { emotion: "explaining", motion: "201" },
          ]
        : [
            { emotion: "neutral", motion: "000" },
            { emotion: "neutral", motion: "001" },
            { emotion: "thinking", motion: "200" },
            { emotion: "happy", motion: "001" },
        ];

    const pick = candidates[Math.floor(Math.random() * candidates.length)];

    this.requestEmotion(pick.emotion, {
      source: "idle",
      motion: pick.motion,
      lockMs: 1400,
    });

    this.scheduleIdle();
  }

  reset() {
    this.clearIdle();
    this.current = {
      emotion: "neutral",
      motion: "000",
      source: "idle",
      priority: SOURCE_PRIORITY.idle,
      lockUntil: 0,
    };

    live2dController.setExpressionById(SAYAKA_BEHAVIOR.neutral.expression);
    live2dController.playMotionById(SAYAKA_BEHAVIOR.neutral.motion);
  }
  log(type, payload) {

    if (!DEBUG_EMOTION_ENGINE) return

    const time = new Date().toLocaleTimeString()

    console.log(
        `%c[EmotionEngine ${type}]`,
        "color:#ff4d6d;font-weight:bold",
        time,
        payload
    )

    }
}

export const emotionEngine = new EmotionEngine();