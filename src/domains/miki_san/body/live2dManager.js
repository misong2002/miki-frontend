import * as PIXI from "pixi.js";
import { Live2DModel } from "pixi-live2d-display/cubism4";
import { MODELS } from "../../../constants/models";
import { live2dController } from "./live2dController";

window.PIXI = PIXI;

export class Live2DManager {
  constructor(container) {
    this.container = container;
    this.app = null;
    this.model = null;
    this.currentModelKey = null;
    this.initialized = false;

    this._tickerBound = false;

    // 仅作调试/状态记录，不直接驱动口型逻辑
    this.speaking = false;
    this.mouthOpen = 0;
  }

  async init() {
    if (this.initialized) return;

    if (!this.container) {
      throw new Error("Live2D container is missing");
    }

    this.container.innerHTML = "";

    this.app = new PIXI.Application({
      autoStart: true,
      resizeTo: this.container,
      backgroundAlpha: 0,
      antialias: true,
    });

    this.app.view.classList.add("live2d-canvas");
    this.container.appendChild(this.app.view);

    // 关键：每帧末尾重新覆盖 mouth 参数
    if (!this._tickerBound) {
      this.app.ticker.add(() => {
        live2dController.applyMouthOverride();
      });
      this._tickerBound = true;
    }

    this.initialized = true;
  }

  async loadModel(modelKey) {
    if (!this.initialized || !this.app) {
      throw new Error("Live2DManager not initialized");
    }

    const path = MODELS[modelKey];
    if (!path) {
      throw new Error(`Unknown model key: ${modelKey}`);
    }

    if (this.model) {
      try {
        this.app.stage.removeChild(this.model);
      } catch (e) {
        console.warn("[Live2DManager] removeChild failed:", e);
      }

      try {
        this.model.destroy();
      } catch (e) {
        console.warn("[Live2DManager] model destroy failed:", e);
      }

      this.model = null;
    }

    const model = await Live2DModel.from(path, { autoInteract: false });

    if (!this.app) {
      model.destroy();
      return;
    }

    this.app.stage.removeChildren();
    this.app.stage.addChild(model);

    this.model = model;
    this.currentModelKey = modelKey;

    this.layout();

    // 模型切换后立刻补一次嘴型覆盖，避免 speaking 中切模型时口型丢失
    live2dController.applyMouthOverride();
  }

  layout() {
    if (!this.app || !this.model) return;

    const w = this.app.renderer.width;
    const h = this.app.renderer.height;

    const bounds = this.model.getLocalBounds();
    const mw = Math.max(bounds.width, 1);
    const mh = Math.max(bounds.height, 1);

    const scale = (h * 1) / mh;
    this.model.scale.set(scale);

    const scaledBounds = this.model.getLocalBounds();

    const targetFootX = w * 0.5;
    const targetFootY = h * 1;

    this.model.x =
      targetFootX -
      (scaledBounds.x + scaledBounds.width / 2) * this.model.scale.x;
    this.model.y =
      targetFootY -
      (scaledBounds.y + scaledBounds.height) * this.model.scale.y;
  }

  async switchTo(modelKey) {
    if (this.currentModelKey === modelKey && this.model) return;
    await this.loadModel(modelKey);
  }

  resize() {
    this.layout();
  }

  destroy() {
    if (this.model && this.app) {
      try {
        this.app.stage.removeChild(this.model);
      } catch (e) {}

      try {
        this.model.destroy();
      } catch (e) {}

      this.model = null;
    }

    if (this.app) {
      const view = this.app.view;

      try {
        this.app.destroy(true, true);
      } catch (e) {}

      if (view && view.parentNode) {
        view.parentNode.removeChild(view);
      }

      this.app = null;
    }

    if (this.container) {
      this.container.innerHTML = "";
    }

    this.initialized = false;
    this._tickerBound = false;
  }

  setExpressionByFileName(fileName) {
    if (!this.model) {
      console.warn("[Live2DManager] model not ready");
      return;
    }

    const settings = this.model.internalModel?.settings;
    const expressions = settings?.expressions || settings?.Expressions || [];

    console.log("[Live2DManager] setExpressionByFileName called:", fileName);
    console.log("[Live2DManager] available expressions:", expressions);
    console.log("[Live2DManager] model.expression:", typeof this.model.expression);
    console.log(
      "[Live2DManager] expressionManager:",
      this.model.internalModel?.expressionManager
    );

    const targetIndex = expressions.findIndex(
      (exp) => exp.File === fileName || exp.Name === fileName
    );

    console.log("[Live2DManager] matched expression index:", targetIndex);

    if (targetIndex < 0) {
      console.warn("[Live2DManager] expression not found:", fileName);
      return;
    }

    try {
      if (typeof this.model.expression === "function") {
        this.model.expression(targetIndex);
        console.log("[Live2DManager] expression applied by model.expression");
        return;
      }

      const expressionManager = this.model.internalModel?.expressionManager;
      if (
        expressionManager &&
        typeof expressionManager.setExpression === "function"
      ) {
        expressionManager.setExpression(targetIndex);
        console.log("[Live2DManager] expression applied by expressionManager");
        return;
      }

      console.warn("[Live2DManager] no expression API available");
    } catch (err) {
      console.error("[Live2DManager] setExpression failed:", err);
    }
  }

  playMotionByName(motionName) {
    if (!this.model) {
      console.warn("[Live2DManager] model not ready");
      return;
    }

    const settings = this.model.internalModel?.settings;
    const motions = settings?.motions || settings?.Motions || {};

    console.log("[Live2DManager] playMotionByName called:", motionName);
    console.log("[Live2DManager] available motion groups:", motions);
    console.log("[Live2DManager] model.motion:", typeof this.model.motion);

    for (const groupName of Object.keys(motions)) {
      const group = motions[groupName];
      if (!Array.isArray(group)) continue;

      console.log(`[Live2DManager] checking group ${groupName}:`, group);

      const index = group.findIndex((m) => {
        return (
          m.Name === motionName ||
          m.File === motionName ||
          m.File?.includes(motionName)
        );
      });

      if (index >= 0) {
        console.log(
          `[Live2DManager] matched motion in group=${groupName}, index=${index}`
        );

        try {
          if (typeof this.model.motion === "function") {
            this.model.motion(groupName, index);
            console.log("[Live2DManager] motion applied by model.motion");
            return;
          }

          console.warn("[Live2DManager] no motion API available");
          return;
        } catch (err) {
          console.error("[Live2DManager] playMotion failed:", err);
          return;
        }
      }
    }

    console.warn("[Live2DManager] motion not found:", motionName);
  }

  /**
   * 供 controller 优先调用的统一口型接口
   */
  setMouthOpen(value) {
    const v = Math.max(0, Math.min(1, Number(value) || 0));
    this.mouthOpen = v;
    return this.setParameterValueById("ParamMouthOpenY", v);
  }

  /**
   * 供 controller 使用的统一参数接口
   */
  setParameterValueById(paramId, value) {
    if (!this.model) return false;

    const v = Number(value) || 0;

    const coreModel =
      this.model?.internalModel?.coreModel ||
      this.model?._internalModel?.coreModel ||
      null;

    if (coreModel?.setParameterValueById) {
      try {
        coreModel.setParameterValueById(paramId, v);
        return true;
      } catch (err) {
        console.warn(
          "[Live2DManager] setParameterValueById coreModel failed:",
          err
        );
      }
    }

    return false;
  }

  /**
   * 只记录 speaking 状态，真正嘴型刷新由 controller+speechEngine 决定
   */
  setSpeaking(active) {
    this.speaking = !!active;
    return true;
  }

  /**
   * motion 停止接口，供 controller.interrupt() 调用
   */
  stopAllMotions() {
    if (!this.model) return false;

    try {
      const motionManager =
        this.model?.internalModel?.motionManager ||
        this.model?._internalModel?.motionManager ||
        null;

      if (motionManager?.stopAllMotions) {
        motionManager.stopAllMotions();
        return true;
      }
    } catch (err) {
      console.warn("[Live2DManager] stopAllMotions failed:", err);
    }

    return false;
  }

  stopMotion() {
    return this.stopAllMotions();
  }
}