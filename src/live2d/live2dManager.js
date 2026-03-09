import * as PIXI from "pixi.js";
import { Live2DModel } from "pixi-live2d-display/cubism4";
import { MODELS } from "../constants/models";

window.PIXI = PIXI;

export class Live2DManager {
  constructor(container) {
    this.container = container;
    this.app = null;
    this.model = null;
    this.currentModelKey = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    if (!this.container) {
      throw new Error("Live2D container is missing");
    }

    // 关键：清空旧 canvas，防止重复 append
    this.container.innerHTML = "";

    this.app = new PIXI.Application({
      autoStart: true,
      resizeTo: this.container,
      backgroundAlpha: 0,
      antialias: true,
    });

    this.app.view.classList.add("live2d-canvas");
    this.container.appendChild(this.app.view);

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

    this.app.stage.removeChildren(); // 关键：确保舞台清空
    this.app.stage.addChild(model);

    this.model = model;
    this.currentModelKey = modelKey;

    this.layout();
  }

  layout() {
    if (!this.app || !this.model) return;

    const w = this.app.renderer.width;
    const h = this.app.renderer.height;

    const bounds = this.model.getLocalBounds();
    const mw = Math.max(bounds.width, 1);
    const mh = Math.max(bounds.height, 1);

    // 先按高度缩放
    const scale = (h * 1) / mh;
    this.model.scale.set(scale);

    // 关键：不要直接拿 x/y 当中心
    // 用 bounds 把“角色底部中心”放到舞台某个点
    const scaledBounds = this.model.getLocalBounds();

    const targetFootX = w * 0.5;  // 左右位置
    const targetFootY = h * 1;  // 脚底落点，越大越靠下

    this.model.x = targetFootX - (scaledBounds.x + scaledBounds.width / 2) * this.model.scale.x;
    this.model.y = targetFootY - (scaledBounds.y + scaledBounds.height) * this.model.scale.y;
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
      if (expressionManager && typeof expressionManager.setExpression === "function") {
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
  }
