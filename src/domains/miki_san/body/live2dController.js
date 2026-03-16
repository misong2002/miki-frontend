import { SAYAKA_EXPRESSIONS, SAYAKA_MOTIONS } from "./sayakaCatalog";

class Live2DController {
  constructor() {
    this.manager = null;

    // 口部覆盖状态
    this.speaking = false;
    this.mouthOverrideValue = 0;
  }

  bindManager(manager) {
    this.manager = manager;
    //console.log("[Live2DController] manager bound:", manager);

    // 新 manager 绑定后立刻同步一次当前口型状态
    this.applyMouthOverride();
  }

  hasManager() {
    return !!this.manager?.model;
  }

  setExpressionById(expressionId) {
    const fileName = SAYAKA_EXPRESSIONS[String(expressionId)];
    //console.log("[Live2DController] setExpressionById:", expressionId, fileName);

    if (!fileName) {
      console.warn("[Live2DController] unknown expression id:", expressionId);
      return false;
    }

    if (!this.hasManager()) {
      console.warn("[Live2DController] manager/model not ready");
      return false;
    }

    this.manager.setExpressionByFileName(fileName);
    return true;
  }

  playMotionById(motionId) {
    const fileName = SAYAKA_MOTIONS[String(motionId)];
    //console.log("[Live2DController] playMotionById:", motionId, fileName);

    if (!fileName) {
      console.warn("[Live2DController] unknown motion id:", motionId);
      return false;
    }

    if (!this.hasManager()) {
      console.warn("[Live2DController] manager/model not ready");
      return false;
    }

    this.manager.playMotionByName(fileName);
    return true;
  }

  /**
   * 说话开关只维护状态，不假设 manager 一定有 speaking API。
   * 真正的嘴型由 mouth override 在每帧刷新时接管。
   */
  setSpeaking(active) {
    this.speaking = !!active;
    //console.log("[Live2DController] setSpeaking:", this.speaking);

    if (!this.speaking) {
      this.mouthOverrideValue = 0;
    }

    // 先立刻尝试写一次；之后 manager ticker 会持续刷新
    this.applyMouthOverride();

    if (!this.hasManager()) return false;

    if (typeof this.manager.setSpeaking === "function") {
      try {
        this.manager.setSpeaking(this.speaking);
      } catch (err) {
        console.warn("[Live2DController] manager.setSpeaking failed:", err);
      }
    }

    return true;
  }

  /**
   * 更新“目标嘴型值”，不再只是一次性碰运气写值。
   * 真正稳定生效依赖 applyMouthOverride() 的每帧覆盖。
   */
  setMouthOpen(value) {
    const v = Math.max(0, Math.min(1, Number(value) || 0));
    this.mouthOverrideValue = v;

    // 先立刻尝试写一次，减少体感延迟
    return this.applyMouthOverride();
  }

  /**
   * 每帧调用，保证嘴部参数在 motion 更新之后仍被覆盖到模型上。
   */
  applyMouthOverride() {
    if (!this.hasManager()) {
      return false;
    }

    const finalValue = this.speaking ? this.mouthOverrideValue : 0;

    // 1. 优先用 manager 暴露的统一接口
    if (typeof this.manager.setMouthOpen === "function") {
      try {
        this.manager.setMouthOpen(finalValue);
        return true;
      } catch (err) {
        console.warn("[Live2DController] manager.setMouthOpen failed:", err);
      }
    }

    // 2. manager 的通用参数接口
    if (typeof this.manager.setParameterValueById === "function") {
      try {
        this.manager.setParameterValueById("ParamMouthOpenY", finalValue);
        return true;
      } catch (err) {
        console.warn(
          "[Live2DController] manager.setParameterValueById failed:",
          err
        );
      }
    }

    // 3. 直接写底层 coreModel
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
    //console.log("[Live2DController] interrupt");

    if (!this.hasManager()) return false;

    if (typeof this.manager.stopAllMotions === "function") {
      this.manager.stopAllMotions();
      return true;
    }

    if (typeof this.manager.stopMotion === "function") {
      this.manager.stopMotion();
      return true;
    }

    return false;
  }

  resetToIdle() {
    this.playMotionById("000");
    this.setExpressionById("50");
    this.setSpeaking(false);
    this.setMouthOpen(0);
  }
}

export const live2dController = new Live2DController();