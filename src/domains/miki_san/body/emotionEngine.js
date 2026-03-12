import { expressionEngine } from "./expressionEngine";
import { motionEngine } from "./motionEngine";
import { speechEngine } from "./speechEngine";

const DEBUG_EMOTION_ENGINE = true;

class EmotionEngineCoordinator {
  constructor() {
    this.mode = "chat";
    this.autonomousBehaviorEnabled = false;
    this.listeners = new Set();

    expressionEngine.subscribe((event) => this.emit(event));
    motionEngine.subscribe((event) => this.emit(event));
    speechEngine.subscribe((event) => this.emit(event));
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
        console.error("[EmotionEngineCoordinator] listener error:", err);
      }
    }
  }

  setMode(mode) {
    this.mode = mode;
    expressionEngine.setMode(mode);
    motionEngine.setMode(mode);
    speechEngine.setMode(mode);

    this.emit({ type: "mode", mode });
  }

  setAutonomousBehaviorEnabled(enabled) {
    this.autonomousBehaviorEnabled = !!enabled;

    this.log("AUTONOMOUS_BEHAVIOR", {
      enabled: this.autonomousBehaviorEnabled,
    });
  }

  setExpressionById(expressionId, options = {}) {
    return expressionEngine.setExpressionById(expressionId, options);
  }

  playMotionById(motionId, options = {}) {
    return motionEngine.playMotionById(motionId, options);
  }

  setSpeaking(active, options = {}) {
    return speechEngine.setSpeaking(active, options);
  }

  interrupt(options = {}) {
    return speechEngine.interrupt(options);
  }

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
    speechEngine.reset();
    expressionEngine.reset();
    motionEngine.reset();

    this.emit({
      type: "reset",
      state: this.getCurrentState(),
    });

    this.log("RESET", {
      state: this.getCurrentState(),
    });
  }

  getCurrentState() {
    return {
      mode: this.mode,
      autonomousBehaviorEnabled: this.autonomousBehaviorEnabled,
      expression: { ...expressionEngine.current },
      motion: { ...motionEngine.current },
      speech: { ...speechEngine.current },
    };
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

export const emotionEngine = new EmotionEngineCoordinator();