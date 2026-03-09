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
      return;
    }

    if (!this.hasManager()) {
      console.warn("[Live2DController] manager/model not ready");
      return;
    }

    this.manager.setExpressionByFileName(fileName);
  }

  playMotionById(motionId) {
    const fileName = SAYAKA_MOTIONS[String(motionId)];
    console.log("[Live2DController] playMotionById:", motionId, fileName);

    if (!fileName) {
      console.warn("[Live2DController] unknown motion id:", motionId);
      return;
    }

    if (!this.hasManager()) {
      console.warn("[Live2DController] manager/model not ready");
      return;
    }

    this.manager.playMotionByName(fileName);
  }

  resetToIdle() {
    this.playMotionById("000");
    this.setExpressionById("10");
  }
}

export const live2dController = new Live2DController();