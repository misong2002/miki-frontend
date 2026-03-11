import { live2dController } from "./live2dController";

const DEBUG_MOTION_ENGINE = true;

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

class MotionEngine {
  constructor() {
    this.mode = "chat";
    this.current = {
      motionId: "000",
      source: "idle",
      priority: SOURCE_PRIORITY.idle,
      lockUntil: 0,
    };
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
        console.error("[MotionEngine] listener error:", err);
      }
    }
  }

  setMode(mode) {
    this.mode = mode;
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

  playMotionById(motionId, options = {}) {
    const source = options.source ?? "idle";
    const force = options.force ?? false;
    const nextId = String(motionId);

    this.log("PLAY_MOTION_ID", {
      motionId: nextId,
      source,
      current: this.current,
    });

    if (!this.canApply(source, force)) {
      return false;
    }

    live2dController.playMotionById(nextId);

    this.current = {
      motionId: nextId,
      source,
      priority: this.getPriority(source),
      lockUntil: this.now() + this.getLockMs(source, options.lockMs),
    };

    this.emit({
      type: "motion",
      motionId: nextId,
      source,
      state: { ...this.current },
    });

    return true;
  }

  reset() {
    this.current = {
      motionId: "000",
      source: "idle",
      priority: SOURCE_PRIORITY.idle,
      lockUntil: 0,
    };

    live2dController.playMotionById("000");

    this.emit({
      type: "motion_reset",
      state: { ...this.current },
    });

    this.log("RESET", { state: this.current });
  }

  log(type, payload) {
    if (!DEBUG_MOTION_ENGINE) return;

    const time = new Date().toLocaleTimeString();
    console.log(
      `%c[MotionEngine ${type}]`,
      "color:#4d7cff;font-weight:bold",
      time,
      payload
    );
  }
}

export const motionEngine = new MotionEngine();