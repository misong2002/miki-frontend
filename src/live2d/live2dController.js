import { SAYAKA_EXPRESSIONS, SAYAKA_MOTIONS } from "./sayakaCatalog";

class Live2DController {
  constructor() {
    this.manager = null;
  }

  bindManager(manager) {
    this.manager = manager;
    console.log("[Live2DController] manager bound:", manager);
  }

  hasManager() {
    return !!this.manager?.model;
  }

  setExpressionById(expressionId) {
    const fileName = SAYAKA_EXPRESSIONS[String(expressionId)];
    console.log("[Live2DController] setExpressionById:", expressionId, fileName);

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
    console.log("[Live2DController] playMotionById:", motionId, fileName);

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
   * 说话状态开关。
   * 当前主要是给上层一个明确接口；
   * 真正的嘴部开合由 setMouthOpen(value) 驱动。
   */
  setSpeaking(active) {
    console.log("[Live2DController] setSpeaking:", active);

    if (!this.hasManager()) return false;

    if (typeof this.manager.setSpeaking === "function") {
      this.manager.setSpeaking(!!active);
      return true;
    }

    return false;
  }

  /**
   * 尝试驱动嘴部参数。
   * 会优先找 manager 暴露的方法；
   * 没有的话再尝试底层 coreModel。
   */
  setMouthOpen(value) {
    const v = Math.max(0, Math.min(1, Number(value) || 0));

    if (!this.hasManager()) {
      return false;
    }

    // 1. 如果 manager 自己暴露了统一接口
    if (typeof this.manager.setMouthOpen === "function") {
      this.manager.setMouthOpen(v);
      return true;
    }

    // 2. 如果 manager 暴露了通用 param 写入接口
    if (typeof this.manager.setParameterValueById === "function") {
      this.manager.setParameterValueById("ParamMouthOpenY", v);
      return true;
    }

    // 3. 尝试直接写到底层 coreModel
    const coreModel =
      this.manager?.model?.internalModel?.coreModel ||
      this.manager?.model?._internalModel?.coreModel ||
      null;

    if (coreModel?.setParameterValueById) {
      try {
        coreModel.setParameterValueById("ParamMouthOpenY", v);
        return true;
      } catch (err) {
        console.warn("[Live2DController] setMouthOpen coreModel failed:", err);
      }
    }

    return false;
  }

  interrupt() {
    console.log("[Live2DController] interrupt");

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
    this.setMouthOpen(0);
    this.setSpeaking(false);
  }
}

export const live2dController = new Live2DController();