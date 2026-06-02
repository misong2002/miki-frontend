export function createExternalityModule({
  initialModelKey = "normal",
  initialPosition = { x: 0.5, y: 0.95 },
  initialScale = 1.0,
  onChange = null,
} = {}) {
  const DEFAULT_ANIMATION_MS = 650;
  const MIN_SCALE = 0.65;
  const MAX_SCALE = 1.35;

  let state = {
    modelKey: initialModelKey,
    position: { ...initialPosition },
    scale: initialScale,
  };
  let animationFrameId = null;

  const contactFeedListeners = new Set();
  const stageListeners = new Set();

  function emitChange() {
    const snapshot = getState();
    onChange?.(snapshot);
    stageListeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (err) {
        console.warn("[externality] stage listener failed:", err);
      }
    });
  }

  function clamp(value, min, max) {
    if (typeof value !== "number" || !Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
  }

  function easeInOutCubic(t) {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function sanitizeStagePatch(nextPartial = {}) {
    const nextPosition = {
      x:
        typeof nextPartial.position?.x === "number"
          ? clamp(nextPartial.position.x, -0.15, 1.15)
          : state.position.x,
      y:
        typeof nextPartial.position?.y === "number"
          ? clamp(nextPartial.position.y, 0.55, 1.25)
          : state.position.y,
    };
    const nextScale =
      typeof nextPartial.scale === "number" && Number.isFinite(nextPartial.scale)
        ? clamp(nextPartial.scale, MIN_SCALE, MAX_SCALE)
        : state.scale;

    return {
      position: nextPosition,
      scale: nextScale,
    };
  }

  function cancelAnimation() {
    if (animationFrameId === null) return;
    window.cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  function emitContactFeed(payload) {
    contactFeedListeners.forEach((listener) => {
      try {
        listener(payload);
      } catch (err) {
        console.warn("[externality] contact feed listener failed:", err);
      }
    });
  }

  function subscribeContactFeed(listener) {
    if (typeof listener !== "function") return () => {};
    contactFeedListeners.add(listener);
    return () => {
      contactFeedListeners.delete(listener);
    };
  }

  function subscribeStage(listener) {
    if (typeof listener !== "function") return () => {};
    stageListeners.add(listener);
    return () => {
      stageListeners.delete(listener);
    };
  }

  function getState() {
    return {
      modelKey: state.modelKey,
      position: { ...state.position },
      scale: state.scale,
    };
  }

  function setModelKey(modelKey) {
    if (!modelKey || modelKey === state.modelKey) return;
    state = {
      ...state,
      modelKey,
    };
    emitChange();
  }

  function setPosition(position) {
    if (
      !position ||
      typeof position.x !== "number" ||
      typeof position.y !== "number"
    ) {
      return;
    }

    state = {
      ...state,
      position: {
        x: clamp(position.x, -0.15, 1.15),
        y: clamp(position.y, 0.55, 1.25),
      },
    };
    emitChange();
  }

  function setScale(scale) {
    if (typeof scale !== "number" || !Number.isFinite(scale)) return;

    state = {
      ...state,
      scale: clamp(scale, MIN_SCALE, MAX_SCALE),
    };
    emitChange();
  }

  function patch(nextPartial = {}) {
    let changed = false;
    const nextState = {
      ...state,
      position: { ...state.position },
    };

    if (
      typeof nextPartial.modelKey === "string" &&
      nextPartial.modelKey &&
      nextPartial.modelKey !== state.modelKey
    ) {
      nextState.modelKey = nextPartial.modelKey;
      changed = true;
    }

    if (
      nextPartial.position &&
      typeof nextPartial.position.x === "number" &&
      typeof nextPartial.position.y === "number"
    ) {
      if (
        nextPartial.position.x !== state.position.x ||
        nextPartial.position.y !== state.position.y
      ) {
        nextState.position = sanitizeStagePatch(nextPartial).position;
        changed = true;
      }
    }

    if (
      typeof nextPartial.scale === "number" &&
      Number.isFinite(nextPartial.scale) &&
      nextPartial.scale !== state.scale
    ) {
      nextState.scale = sanitizeStagePatch(nextPartial).scale;
      changed = true;
    }

    if (!changed) return;

    state = nextState;
    emitChange();
  }

  function animateTo(nextPartial = {}, options = {}) {
    if (typeof window === "undefined" || !window.requestAnimationFrame) {
      patch(nextPartial);
      return Promise.resolve(getState());
    }

    cancelAnimation();

    const target = sanitizeStagePatch(nextPartial);
    const from = getState();
    const duration = clamp(
      Number(options.durationMs ?? nextPartial.durationMs ?? DEFAULT_ANIMATION_MS),
      120,
      1800
    );
    const startedAt = window.performance?.now?.() ?? Date.now();

    return new Promise((resolve) => {
      const tick = (now) => {
        const elapsed = now - startedAt;
        const t = clamp(elapsed / duration, 0, 1);
        const eased = easeInOutCubic(t);

        state = {
          ...state,
          position: {
            x: from.position.x + (target.position.x - from.position.x) * eased,
            y: from.position.y + (target.position.y - from.position.y) * eased,
          },
          scale: from.scale + (target.scale - from.scale) * eased,
        };
        emitChange();

        if (t < 1) {
          animationFrameId = window.requestAnimationFrame(tick);
          return;
        }

        animationFrameId = null;
        state = {
          ...state,
          position: target.position,
          scale: target.scale,
        };
        emitChange();
        resolve(getState());
      };

      animationFrameId = window.requestAnimationFrame(tick);
    });
  }

  return {
    getState,
    setModelKey,
    setPosition,
    setScale,
    patch,
    animateTo,
    emitContactFeed,
    subscribeContactFeed,
    subscribeStage,
  };
}
