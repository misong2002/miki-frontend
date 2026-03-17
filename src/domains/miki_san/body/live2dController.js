import {
  getExpressionFileById,
  getMotionFileById,
} from "./types/sayakaCatalog";

class Live2DController {
  constructor() {
    this.manager = null;
    this.speaking = false;
    this.mouthOverrideValue = 0;
  }

  bindManager(manager) {
    this.manager = manager ?? null;
    this.applyMouthOverride();
  }

  hasManager() {
    return !!this.manager?.model;
  }

  setExpressionById(expressionId) {
    const nextId = String(expressionId);
    const fileName = getExpressionFileById(nextId);

    if (!fileName) {
      console.warn("[Live2DController] unknown expression id:", expressionId);
      return false;
    }

    if (!this.hasManager()) {
      console.warn("[Live2DController] manager/model not ready");
      return false;
    }

    try {
      return this.manager.setExpressionByFileName(fileName) === true;
    } catch (err) {
      console.warn("[Live2DController] setExpressionById failed:", err);
      return false;
    }
  }

  playMotionById(motionId) {
    const nextId = String(motionId);
    const fileName = getMotionFileById(nextId);

    if (!fileName) {
      console.warn("[Live2DController] unknown motion id:", motionId);
      return false;
    }

    if (!this.hasManager()) {
      console.warn("[Live2DController] manager/model not ready");
      return false;
    }

    try {
      return this.manager.playMotionByName(fileName) === true;
    } catch (err) {
      console.warn("[Live2DController] playMotionById failed:", err);
      return false;
    }
  }

  /**
   * 这里只维护 speaking 状态。
   * 真正的嘴型值由 mouth override + manager ticker 每帧覆盖。
   */
  setSpeaking(active) {
    this.speaking = !!active;

    if (!this.speaking) {
      this.mouthOverrideValue = 0;
    }

    const applied = this.applyMouthOverride();

    if (!this.hasManager()) {
      return applied;
    }

    if (typeof this.manager.setSpeaking === "function") {
      try {
        this.manager.setSpeaking(this.speaking);
      } catch (err) {
        console.warn("[Live2DController] manager.setSpeaking failed:", err);
      }
    }

    return applied;
  }

  /**
   * 只更新目标嘴型值。
   * 落到模型上的动作由 applyMouthOverride 统一完成。
   */
  setMouthOpen(value) {
    const next = Math.max(0, Math.min(1, Number(value) || 0));
    this.mouthOverrideValue = next;
    return this.applyMouthOverride();
  }

  applyMouthOverride() {
    if (!this.hasManager()) {
      return false;
    }

    const finalValue = this.speaking ? this.mouthOverrideValue : 0;

    if (typeof this.manager.setMouthOpen === "function") {
      try {
        return this.manager.setMouthOpen(finalValue) === true;
      } catch (err) {
        console.warn("[Live2DController] manager.setMouthOpen failed:", err);
      }
    }

    if (typeof this.manager.setParameterValueById === "function") {
      try {
        return (
          this.manager.setParameterValueById("ParamMouthOpenY", finalValue) ===
          true
        );
      } catch (err) {
        console.warn(
          "[Live2DController] manager.setParameterValueById failed:",
          err
        );
      }
    }

    const coreModel =
      this.manager?.model?.internalModel?.coreModel ||
      this.manager?.model?._internalModel?.coreModel ||
      null;

    if (coreModel?.setParameterValueById) {
      try {
        coreModel.setParameterValueById("ParamMouthOpenY", finalValue);
        return true;
      } catch (err) {
        console.warn("[Live2DController] setMouthOpen coreModel failed:", err);
      }
    }

    return false;
  }

  interrupt() {
    if (!this.hasManager()) return false;

    if (typeof this.manager.stopAllMotions === "function") {
      try {
        return this.manager.stopAllMotions() === true;
      } catch (err) {
        console.warn("[Live2DController] stopAllMotions failed:", err);
        return false;
      }
    }

    if (typeof this.manager.stopMotion === "function") {
      try {
        return this.manager.stopMotion() === true;
      } catch (err) {
        console.warn("[Live2DController] stopMotion failed:", err);
        return false;
      }
    }

    return false;
  }

  resetToIdle() {
    const motionApplied = this.playMotionById("000");
    const expressionApplied = this.setExpressionById("50");
    this.setSpeaking(false);
    this.setMouthOpen(0);

    return motionApplied || expressionApplied;
  }
}

export const live2dController = new Live2DController();