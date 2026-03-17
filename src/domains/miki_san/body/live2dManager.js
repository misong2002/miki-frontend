import * as PIXI from "pixi.js";
import { Live2DModel } from "pixi-live2d-display/cubism4";
import { MODELS } from "../../../constants/models";
import { live2dController } from "./live2dController";

window.PIXI = PIXI;

const DEFAULT_LAYOUT = {
  position: { x: 0.5, y: 1.0 },
  scale: 1.0,
};

export class Live2DManager {
  constructor(container) {
    this.container = container;
    this.app = null;
    this.model = null;
    this.currentModelKey = null;
    this.initialized = false;

    this._tickerBound = false;
    this._loadToken = 0;

    this.layoutState = {
      position: { ...DEFAULT_LAYOUT.position },
      scale: DEFAULT_LAYOUT.scale,
    };

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

    const token = ++this._loadToken;
    const nextModel = await Live2DModel.from(path, { autoInteract: false });

    /**
     * 只允许最后一次请求提交。
     * 避免 normal -> magical -> normal 之类快速切换时旧请求反压回来。
     */
    if (token !== this._loadToken) {
      try {
        nextModel.destroy();
      } catch (err) {
        console.warn("[Live2DManager] stale model destroy failed:", err);
      }
      return false;
    }

    if (!this.app) {
      try {
        nextModel.destroy();
      } catch (err) {
        console.warn("[Live2DManager] app missing, destroy model failed:", err);
      }
      return false;
    }

    if (this.model) {
      try {
        this.app.stage.removeChild(this.model);
      } catch (err) {
        console.warn("[Live2DManager] removeChild failed:", err);
      }

      try {
        this.model.destroy();
      } catch (err) {
        console.warn("[Live2DManager] model destroy failed:", err);
      }

      this.model = null;
    }

    this.app.stage.removeChildren();
    this.app.stage.addChild(nextModel);

    this.model = nextModel;
    this.currentModelKey = modelKey;

    this.layout();
    live2dController.applyMouthOverride();

    return true;
  }

  async switchTo(modelKey) {
    if (this.currentModelKey === modelKey && this.model) {
      return true;
    }
    return this.loadModel(modelKey);
  }

  setLayout({
    position = this.layoutState.position,
    scale = this.layoutState.scale,
  } = {}) {
    const nextPosition =
      position &&
      typeof position.x === "number" &&
      typeof position.y === "number"
        ? { x: position.x, y: position.y }
        : { ...this.layoutState.position };

    const nextScale =
      typeof scale === "number" && Number.isFinite(scale)
        ? scale
        : this.layoutState.scale;

    this.layoutState = {
      position: nextPosition,
      scale: nextScale,
    };

    this.layout();
  }

  layout() {
    if (!this.app || !this.model) return;

    const w = this.app.renderer.width;
    const h = this.app.renderer.height;

    const bounds = this.model.getLocalBounds();
    const mw = Math.max(bounds.width, 1);
    const mh = Math.max(bounds.height, 1);

    const { position, scale } = this.layoutState;

    const baseScale = h / mh;
    const finalScale = baseScale * scale;

    this.model.scale.set(finalScale);

    const scaledBounds = this.model.getLocalBounds();

    const targetFootX = w * position.x;
    const targetFootY = h * position.y;

    this.model.x =
      targetFootX -
      (scaledBounds.x + scaledBounds.width / 2) * this.model.scale.x;

    this.model.y =
      targetFootY -
      (scaledBounds.y + scaledBounds.height) * this.model.scale.y;
  }

  resize() {
    this.layout();
  }

  destroy() {
    this._loadToken += 1;

    if (this.model && this.app) {
      try {
        this.app.stage.removeChild(this.model);
      } catch (err) {}

      try {
        this.model.destroy();
      } catch (err) {}

      this.model = null;
    }

    if (this.app) {
      const view = this.app.view;

      try {
        this.app.destroy(true, true);
      } catch (err) {}

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
    this.currentModelKey = null;
  }

  setExpressionByFileName(fileName) {
    if (!this.model) {
      console.warn("[Live2DManager] model not ready");
      return false;
    }

    const settings = this.model.internalModel?.settings;
    const expressions = settings?.expressions || settings?.Expressions || [];

    const targetIndex = expressions.findIndex(
      (exp) => exp.File === fileName || exp.Name === fileName
    );

    if (targetIndex < 0) {
      console.warn("[Live2DManager] expression not found:", fileName);
      return false;
    }

    try {
      if (typeof this.model.expression === "function") {
        this.model.expression(targetIndex);
        return true;
      }

      const expressionManager = this.model.internalModel?.expressionManager;
      if (
        expressionManager &&
        typeof expressionManager.setExpression === "function"
      ) {
        expressionManager.setExpression(targetIndex);
        return true;
      }

      console.warn("[Live2DManager] no expression API available");
      return false;
    } catch (err) {
      console.error("[Live2DManager] setExpression failed:", err);
      return false;
    }
  }

  playMotionByName(motionName) {
    if (!this.model) {
      console.warn("[Live2DManager] model not ready");
      return false;
    }

    const settings = this.model.internalModel?.settings;
    const motions = settings?.motions || settings?.Motions || {};

    for (const groupName of Object.keys(motions)) {
      const group = motions[groupName];
      if (!Array.isArray(group)) continue;

      const index = group.findIndex((m) => {
        return (
          m.Name === motionName ||
          m.File === motionName ||
          m.File?.includes(motionName)
        );
      });

      if (index >= 0) {
        try {
          if (typeof this.model.motion === "function") {
            this.model.motion(groupName, index);
            return true;
          }

          console.warn("[Live2DManager] no motion API available");
          return false;
        } catch (err) {
          console.error("[Live2DManager] playMotion failed:", err);
          return false;
        }
      }
    }

    console.warn("[Live2DManager] motion not found:", motionName);
    return false;
  }

  setMouthOpen(value) {
    const next = Math.max(0, Math.min(1, Number(value) || 0));
    this.mouthOpen = next;
    return this.setParameterValueById("ParamMouthOpenY", next);
  }

  setParameterValueById(paramId, value) {
    if (!this.model) return false;

    const next = Number(value) || 0;

    const coreModel =
      this.model?.internalModel?.coreModel ||
      this.model?._internalModel?.coreModel ||
      null;

    if (coreModel?.setParameterValueById) {
      try {
        coreModel.setParameterValueById(paramId, next);
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

  setSpeaking(active) {
    this.speaking = !!active;
    return true;
  }

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
}