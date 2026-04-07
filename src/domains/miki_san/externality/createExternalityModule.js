export function createExternalityModule({
  initialModelKey = "normal",
  initialPosition = { x: 0.5, y: 0.95 },
  initialScale = 1.0,
  onChange = null,
} = {}) {
  let state = {
    modelKey: initialModelKey,
    position: { ...initialPosition },
    scale: initialScale,
  };

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
        x: position.x,
        y: position.y,
      },
    };
    emitChange();
  }

  function setScale(scale) {
    if (typeof scale !== "number" || !Number.isFinite(scale)) return;

    state = {
      ...state,
      scale,
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
        nextState.position = {
          x: nextPartial.position.x,
          y: nextPartial.position.y,
        };
        changed = true;
      }
    }

    if (
      typeof nextPartial.scale === "number" &&
      Number.isFinite(nextPartial.scale) &&
      nextPartial.scale !== state.scale
    ) {
      nextState.scale = nextPartial.scale;
      changed = true;
    }

    if (!changed) return;

    state = nextState;
    emitChange();
  }

  return {
    getState,
    setModelKey,
    setPosition,
    setScale,
    patch,
    emitContactFeed,
    subscribeContactFeed,
    subscribeStage,
  };
}