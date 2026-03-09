import { SAYAKA_EXPRESSIONS, SAYAKA_MOTIONS } from "./sayakaCatalog";

class Live2DController {
  constructor() {
    this.manager = null;
  }

  bindManager(manager) {
    this.manager = manager;
  }

  hasManager() {
    return !!this.manager?.model;
  }

  setExpressionById(expressionId) {
    if (!this.hasManager()) {
      console.warn("[Live2DController] manager/model not ready");
      return;
    }

    const expressionName = SAYAKA_EXPRESSIONS[String(expressionId)];
    if (!expressionName) {
      console.warn("[Live2DController] unknown expression id:", expressionId);
      return;
    }

    this.manager.setExpressionByFileName?.(expressionName);
  }

  playMotionById(motionId) {
    if (!this.hasManager()) {
      console.warn("[Live2DController] manager/model not ready");
      return;
    }

    const motionName = SAYAKA_MOTIONS[String(motionId)];
    if (!motionName) {
      console.warn("[Live2DController] unknown motion id:", motionId);
      return;
    }

    this.manager.playMotionByName?.(motionName);
  }

  resetToIdle() {
    if (!this.hasManager()) return;
    this.playMotionById("000");
    this.setExpressionById("10");
  }
}

export const live2dController = new Live2DController();