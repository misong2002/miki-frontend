import { live2dController } from "./live2dController";

const DEBUG_EMOTION_ENGINE = true;

const SOURCE_PRIORITY = {
  idle: 1,
  battle: 2,
  typing: 3,
  orchestrator: 4,
  llm: 4,
  interrupt: 5,
};

const DEFAULT_LOCK_MS = {
  idle: 1200,
  battle: 1500,
  typing: 800,
  orchestrator: 1200,
  llm: 1200,
  interrupt: 2200,
};

class EmotionEngine {
  constructor() {
    this.mode = "chat";

    this.current = {
      expressionId: "50",
      motionId: "000",
      source: "idle",
      priority: SOURCE_PRIORITY.idle,
      lockUntil: 0,
      speaking: false,
    };

    this.listeners = new Set();

    this.autonomousBehaviorEnabled = false;

    this.mouthTimer = null;
    this.mouthPhase = 0;
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

  setAutonomousBehaviorEnabled(enabled) {
    this.autonomousBehaviorEnabled = !!enabled;

    this.log("AUTONOMOUS_BEHAVIOR", {
      enabled: this.autonomousBehaviorEnabled,
    });
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

  updateLock(source, lockMs) {
    this.current = {
      ...this.current,
      source,
      priority: this.getPriority(source),
      lockUntil: this.now() + this.getLockMs(source, lockMs),
    };
  }

  setExpressionById(expressionId, options = {}) {
    const source = options.source ?? "idle";
    const force = options.force ?? false;

    this.log("SET_EXPRESSION_ID", {
      expressionId,
      source,
      current: this.current,
    });

    if (!this.canApply(source, force)) {
      return false;
    }

    const nextId = String(expressionId);
    live2dController.setExpressionById(nextId);

    this.current = {
      ...this.current,
      expressionId: nextId,
    };
    this.updateLock(source, options.lockMs);

    this.emit({
      type: "expression",
      expressionId: nextId,
      source,
      state: { ...this.current },
    });

    return true;
  }

  playMotionById(motionId, options = {}) {
    const source = options.source ?? "idle";
    const force = options.force ?? false;

    this.log("PLAY_MOTION_ID", {
      motionId,
      source,
      current: this.current,
    });

    if (!this.canApply(source, force)) {
      return false;
    }

    const nextId = String(motionId);
    live2dController.playMotionById(nextId);

    this.current = {
      ...this.current,
      motionId: nextId,
    };
    this.updateLock(source, options.lockMs);

    this.emit({
      type: "motion",
      motionId: nextId,
      source,
      state: { ...this.current },
    });

    return true;
  }

  setSpeaking(active, options = {}) {
    const next = !!active;
    const source = options.source ?? "typing";

    if (this.current.speaking === next) return false;

    this.current = {
      ...this.current,
      speaking: next,
      source,
      priority: this.getPriority(source),
    };

    live2dController.setSpeaking(next);

    if (next) {
      this.startMouthLoop();
    } else {
      this.stopMouthLoop();
      live2dController.setMouthOpen(0);
    }

    this.emit({
      type: "speaking",
      active: next,
      source,
      state: { ...this.current },
    });

    this.log("SET_SPEAKING", {
      active: next,
      source,
    });

    return true;
  }

  startMouthLoop() {
    if (this.mouthTimer) return;

    this.mouthPhase = 0;
    this.mouthTimer = setInterval(() => {
      this.mouthPhase += 1;

      // 一个很轻量的口型循环，后面可替换成 token/音频驱动
      const pattern = [0.15, 0.55, 0.9, 0.35, 0.7, 0.1];
      const value = pattern[this.mouthPhase % pattern.length];

      live2dController.setMouthOpen(value);
    }, 90);
  }

  stopMouthLoop() {
    if (this.mouthTimer) {
      clearInterval(this.mouthTimer);
      this.mouthTimer = null;
    }
  }

  interrupt(options = {}) {
    const source = options.source ?? "interrupt";

    this.log("INTERRUPT", {
      source,
      current: this.current,
    });

    this.stopMouthLoop();
    live2dController.setMouthOpen(0);
    live2dController.setSpeaking(false);
    live2dController.interrupt();

    this.current = {
      ...this.current,
      speaking: false,
      source,
      priority: this.getPriority(source),
      lockUntil: this.now() + this.getLockMs(source, options.lockMs ?? 2200),
    };

    this.emit({
      type: "interrupt",
      source,
      state: { ...this.current },
    });

    return true;
  }

  /**
   * 旧接口保留，但不再控制模型行为。
   */
  setTypingState(kind = "thinking") {
    this.log("SET_TYPING_STATE_IGNORED", {
      kind,
      autonomousBehaviorEnabled: this.autonomousBehaviorEnabled,
    });

    return false;
  }

  notifyUserActivity() {
    this.log("USER_ACTIVITY", {
      autonomousBehaviorEnabled: this.autonomousBehaviorEnabled,
    });
  }

  setBattleState(kind) {
    this.log("SET_BATTLE_STATE_IGNORED", {
      kind,
      autonomousBehaviorEnabled: this.autonomousBehaviorEnabled,
    });

    return false;
  }

  reset() {
    this.stopMouthLoop();
    live2dController.setMouthOpen(0);
    live2dController.setSpeaking(false);

    this.current = {
      expressionId: "50",
      motionId: "000",
      source: "idle",
      priority: SOURCE_PRIORITY.idle,
      lockUntil: 0,
      speaking: false,
    };

    live2dController.setExpressionById("50");
    live2dController.playMotionById("000");

    this.emit({
      type: "reset",
      state: { ...this.current },
    });

    this.log("RESET", {
      state: this.current,
    });
  }

  log(type, payload) {
    if (!DEBUG_EMOTION_ENGINE) return;

    const time = new Date().toLocaleTimeString();

    console.log(
      `%c[EmotionEngine ${type}]`,
      "color:#ff4d6d;font-weight:bold",
      time,
      payload
    );
  }
}

export const emotionEngine = new EmotionEngine();