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

    // 让 PIXI 自己创建 canvas，不要传 view
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
      this.app.stage.removeChild(this.model);
      this.model.destroy();
      this.model = null;
    }

    const model = await Live2DModel.from(path, {
      autoInteract: false,
    });

    // 防止在 await 期间组件已经卸载
    if (!this.app) {
      model.destroy();
      return;
    }

    model.anchor.set(0.5, 0.5);
    model.interactive = false;

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

    // 目标：模型高度约为舞台高度的 90%
    const scale = (h * 1.1) / mh;
    this.model.scale.set(scale);

    // 中间偏左
    this.model.x = w * 0.5;
    this.model.y = h * 0.5;
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
      this.app.stage.removeChild(this.model);
      this.model.destroy();
      this.model = null;
    }

    if (this.app) {
      const view = this.app.view;
      this.app.destroy(true, true);
      if (view && view.parentNode) {
        view.parentNode.removeChild(view);
      }
      this.app = null;
    }

    this.initialized = false;
  }
  setExpressionByFileName(fileName) {
    if (!this.model?.internalModel?.expressionManager) {
      console.warn("[Live2DManager] expressionManager not available");
      return;
    }

    const expressions = this.model.internalModel.settings?.expressions || [];
    const targetIndex = expressions.findIndex((exp) => exp.File === fileName || exp.Name === fileName);

    if (targetIndex < 0) {
      console.warn("[Live2DManager] expression not found:", fileName);
      return;
    }

    this.model.expression(targetIndex);
  }

  playMotionByName(motionName) {
    if (!this.model) {
      console.warn("[Live2DManager] model not ready");
      return;
    }

    // 这里要根据你当前使用的 pixi-live2d-display 版本做适配
    // 常见情况是 motions 在 internalModel.settings.motions 里
    const motions = this.model.internalModel?.settings?.motions;
    if (!motions) {
      console.warn("[Live2DManager] motions not available");
      return;
    }

    for (const groupName of Object.keys(motions)) {
      const group = motions[groupName];
      const index = group.findIndex((m) => m.Name === motionName || m.File?.includes(motionName));

      if (index >= 0) {
        this.model.motion(groupName, index);
        return;
      }
    }

    console.warn("[Live2DManager] motion not found:", motionName);
  }
}
