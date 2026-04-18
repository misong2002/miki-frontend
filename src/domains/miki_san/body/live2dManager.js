import * as PIXI from "pixi.js";
import { Live2DModel } from "pixi-live2d-display/cubism4";
import { MODELS } from "../../../constants/models";
import { live2dController } from "./live2dController";

window.PIXI = PIXI;

const DEFAULT_LAYOUT = {
  position: { x: 0.5, y: 1.0 },
  scale: 1.0,
};

const POINTER_FOCUS_PADDING_PX = 120;

export class Live2DManager {
  constructor(container, { onInteraction = null } = {}) {
    this.container = container;
    this.onInteraction = typeof onInteraction === "function" ? onInteraction : null;
    this.app = null;
    this.model = null;
    this.currentModelKey = null;
    this.initialized = false;

    this._tickerBound = false;
    this._loadToken = 0;
    this._pointerFocusBound = false;
    this._pointerFocusActive = false;
    this._pointerPosition = null;
    this._modelPoint = new PIXI.Point();

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
        this.updatePointerFocus();
      });
      this._tickerBound = true;
    }

    this.bindPointerFocus();

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
    this._pointerFocusActive = false;

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

  bindPointerFocus() {
    if (!this.app?.view || this._pointerFocusBound) return;

    this._handlePointerMove = (event) => {
      const point = this.getRendererPointFromPointerEvent(event);
      if (!point) return;

      this._pointerPosition = point;
    };

    this._handlePointerLeave = () => {
      this._pointerPosition = null;
      this.resetPointerFocus();
    };

    this._handlePointerTap = (event) => {
      const point = this.getRendererPointFromPointerEvent(event);
      if (!point) return;

      const hitAreaId = this.getHitAreaIdAt(point.x, point.y);
      const tapTypeByHitArea = {
        HitAreaHead: "head_tap",
        HitAreaBody: "body_tap",
      };
      const type = tapTypeByHitArea[hitAreaId];
      if (!type) return;

      this.emitInteraction({
        type,
        hitAreaId,
        x: point.x,
        y: point.y,
      });
    };

    this.app.view.addEventListener("pointermove", this._handlePointerMove);
    this.app.view.addEventListener("pointerleave", this._handlePointerLeave);
    this.app.view.addEventListener("pointerup", this._handlePointerTap);
    this._pointerFocusBound = true;
  }

  unbindPointerFocus() {
    if (!this.app?.view || !this._pointerFocusBound) return;

    this.app.view.removeEventListener("pointermove", this._handlePointerMove);
    this.app.view.removeEventListener("pointerleave", this._handlePointerLeave);
    this.app.view.removeEventListener("pointerup", this._handlePointerTap);

    this._handlePointerMove = null;
    this._handlePointerLeave = null;
    this._handlePointerTap = null;
    this._pointerPosition = null;
    this._pointerFocusBound = false;
    this._pointerFocusActive = false;
  }

  getRendererPointFromPointerEvent(event) {
    if (!this.app?.view || !this.app?.renderer) return null;

    const rect = this.app.view.getBoundingClientRect();
    const width = Math.max(rect.width, 1);
    const height = Math.max(rect.height, 1);

    return {
      x: ((event.clientX - rect.left) / width) * this.app.renderer.width,
      y: ((event.clientY - rect.top) / height) * this.app.renderer.height,
    };
  }

  getHitAreaIdAt(x, y) {
    if (!this.model?.internalModel) return null;

    const internalModel = this.model.internalModel;
    const settings = internalModel.settings;
    const hitAreas = settings?.hitAreas || settings?.HitAreas || [];

    if (!Array.isArray(hitAreas) || hitAreas.length === 0) return null;

    this._modelPoint.set(x, y);
    this.model.toModelPosition(this._modelPoint, this._modelPoint);

    const orderedHitAreas = [...hitAreas].sort((a, b) => {
      const aId = a?.Id ?? a?.id;
      const bId = b?.Id ?? b?.id;
      if (aId === "HitAreaHead") return -1;
      if (bId === "HitAreaHead") return 1;
      return 0;
    });

    for (const area of orderedHitAreas) {
      const areaId = area?.Id ?? area?.id;
      if (!areaId) continue;

      const drawableIndex =
        internalModel.getDrawableIndex?.(areaId) ??
        internalModel.coreModel?.getDrawableIndex?.(areaId) ??
        -1;

      if (drawableIndex < 0) continue;

      const bounds = internalModel.getDrawableBounds?.(drawableIndex, {});
      if (!bounds) continue;

      const inside =
        bounds.x <= this._modelPoint.x &&
        this._modelPoint.x <= bounds.x + bounds.width &&
        bounds.y <= this._modelPoint.y &&
        this._modelPoint.y <= bounds.y + bounds.height;

      if (inside) return areaId;
    }

    return null;
  }

  emitInteraction(payload) {
    if (!this.onInteraction) return;

    try {
      this.onInteraction(payload);
    } catch (err) {
      console.warn("[Live2DManager] onInteraction failed:", err);
    }
  }

  updatePointerFocus() {
    if (!this.model || !this._pointerPosition) return;

    const bounds = this.model.getBounds();
    const padding = POINTER_FOCUS_PADDING_PX;
    const left = bounds.x - padding;
    const right = bounds.x + bounds.width + padding;
    const top = bounds.y - padding;
    const bottom = bounds.y + bounds.height + padding;
    const { x, y } = this._pointerPosition;

    if (x >= left && x <= right && y >= top && y <= bottom) {
      this.model.focus(x, y);
      this._pointerFocusActive = true;
      return;
    }

    this.resetPointerFocus();
  }

  resetPointerFocus() {
    if (!this._pointerFocusActive) return;

    const focusController = this.model?.internalModel?.focusController;
    if (focusController?.focus) {
      focusController.focus(0, 0);
    }

    this._pointerFocusActive = false;
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

    this.unbindPointerFocus();

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