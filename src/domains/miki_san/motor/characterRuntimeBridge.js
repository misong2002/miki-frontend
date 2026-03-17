function callSafely(fn, label) {
  try {
    return fn();
  } catch (err) {
    console.warn(`[CharacterRuntimeBridge] ${label} failed:`, err);
    return false;
  }
}

export function createCharacterRuntimeBridge({ emotionEngine }) {
  let speechOn = false;
  let lastExpressionId = null;
  let lastMotionId = null;

  function setExpression(expressionId) {
    if (expressionId == null) return false;

    const nextId = String(expressionId);
    if (lastExpressionId === nextId) return false;

    const applied =
      callSafely(
        () =>
          emotionEngine?.setExpressionById?.(nextId, {
            source: "orchestrator",
          }) === true,
        "setExpressionById"
      ) === true;

    /**
     * 只有底层真正成功，才更新去重缓存。
     */
    if (applied) {
      lastExpressionId = nextId;
    }

    return applied;
  }

  function playMotion(motionId) {
    if (motionId == null) return false;

    const nextId = String(motionId);
    if (lastMotionId === nextId) return false;

    const applied =
      callSafely(
        () =>
          emotionEngine?.playMotionById?.(nextId, {
            source: "orchestrator",
          }) === true,
        "playMotionById"
      ) === true;

    /**
     * 只有底层真正成功，才更新去重缓存。
     */
    if (applied) {
      lastMotionId = nextId;
    }

    return applied;
  }

  function setSpeech(active) {
    const next = !!active;
    if (speechOn === next) return false;

    const applied =
      callSafely(
        () =>
          emotionEngine?.setSpeaking?.(next, {
            source: "orchestrator",
          }) === true,
        next ? "setSpeaking(true)" : "setSpeaking(false)"
      ) === true;

    if (applied) {
      speechOn = next;
    }

    return applied;
  }

  function clearPresentationCache() {
    lastExpressionId = null;
    lastMotionId = null;
  }

  /**
   * INTERRUPT 的语义：
   * - 先做 interrupt，打断当前语音/动作链
   * - 再 reset，把表情和动作清空回默认态
   * - 同时清空 bridge 自己的去重缓存
   */
  function interruptAndClear() {
    speechOn = false;
    clearPresentationCache();

    let applied = false;

    const interrupted =
      callSafely(
        () =>
          emotionEngine?.interrupt?.({
            source: "orchestrator",
          }) === true,
        "interrupt"
      ) === true;

    applied = interrupted || applied;

    const resetApplied =
      callSafely(() => {
        if (typeof emotionEngine?.reset !== "function") return false;
        emotionEngine.reset();
        return true;
      }, "reset(after interrupt)") === true;

    applied = resetApplied || applied;

    return applied;
  }

  function resetAll() {
    speechOn = false;
    clearPresentationCache();

    return (
      callSafely(() => {
        if (typeof emotionEngine?.reset !== "function") return false;
        emotionEngine.reset();
        return true;
      }, "reset") === true
    );
  }

  return {
    apply(command = {}) {
      switch (command.type) {
        case "SET_EMOTION":
          return setExpression(command.value);

        case "PLAY_MOTION":
          return playMotion(command.value);

        case "SET_SPEECH":
          return setSpeech(true);

        case "STOP_SPEECH":
          return setSpeech(false);

        case "INTERRUPT":
          return interruptAndClear();

        case "RESET":
          return resetAll();

        default:
          return false;
      }
    },
  };
}