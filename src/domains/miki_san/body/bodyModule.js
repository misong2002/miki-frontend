import { expressionEngine } from "./engines/expressionEngine";
import { motionEngine } from "./engines/motionEngine";
import { speechEngine } from "./engines/speechEngine";

const DEBUG_EMOTION_ENGINE = true;

/**
 * 这个文件本质上是 body 层协调器。
 * 名字先不动，避免上层 import 改动。
 */
class BodyEngineCoordinator {
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
    return true;
  }

  setAutonomousBehaviorEnabled(enabled) {
    this.autonomousBehaviorEnabled = !!enabled;

    this.log("AUTONOMOUS_BEHAVIOR", {
      enabled: this.autonomousBehaviorEnabled,
    });

    return true;
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
    /**
     * 目前 interrupt 的 body 语义主要由 speechEngine 统一触发：
     * - 停止嘴型
     * - 调 live2dController.interrupt
     */
    return speechEngine.interrupt(options);
  }

  /**
   * 先保留兼容接口，但不再伪装成真的“状态驱动器”。
   */
  setTypingState(kind = "thinking") {
    this.log("SET_TYPING_STATE_UNIMPLEMENTED", {
      kind,
      autonomousBehaviorEnabled: this.autonomousBehaviorEnabled,
    });
    return false;
  }

  notifyUserActivity() {
    this.log("USER_ACTIVITY", {
      autonomousBehaviorEnabled: this.autonomousBehaviorEnabled,
    });
    return true;
  }

  setBattleState(kind) {
    this.log("SET_BATTLE_STATE_UNIMPLEMENTED", {
      kind,
      autonomousBehaviorEnabled: this.autonomousBehaviorEnabled,
    });
    return false;
  }

  reset() {
    const speechApplied = speechEngine.reset();
    const expressionApplied = expressionEngine.reset();
    const motionApplied = motionEngine.reset();

    const state = this.getCurrentState();

    this.emit({
      type: "reset",
      state,
    });

    this.log("RESET", {
      state,
      speechApplied,
      expressionApplied,
      motionApplied,
    });

    return speechApplied || expressionApplied || motionApplied;
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

export const emotionEngine = new BodyEngineCoordinator();