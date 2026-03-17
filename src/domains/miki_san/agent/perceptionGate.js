export function createPerceptionGate({
  cooldownMs = 5000,
  sameFeatureSuppressMs = 30000,
} = {}) {
  let lastPerceptionTime = 0;
  let lastPerceptionComment = null;
  let lastPerceptionFeature = null;
  let lastFeatureTime = 0;

  function shouldEmit({ comment, feature, now = Date.now() }) {
    if (!comment || feature === "none") {
      return false;
    }

    if (now - lastPerceptionTime < cooldownMs) {
      return false;
    }

    if (comment === lastPerceptionComment) {
      return false;
    }

    if (
      feature === lastPerceptionFeature &&
      now - lastFeatureTime < sameFeatureSuppressMs
    ) {
      return false;
    }

    return true;
  }

  function markEmitted({ comment, feature, now = Date.now() }) {
    lastPerceptionTime = now;
    lastPerceptionComment = comment;
    lastPerceptionFeature = feature;
    lastFeatureTime = now;
  }

  function reset() {
    lastPerceptionTime = 0;
    lastPerceptionComment = null;
    lastPerceptionFeature = null;
    lastFeatureTime = 0;
  }

  function getState() {
    return {
      lastPerceptionTime,
      lastPerceptionComment,
      lastPerceptionFeature,
      lastFeatureTime,
      cooldownMs,
      sameFeatureSuppressMs,
    };
  }

  return {
    shouldEmit,
    markEmitted,
    reset,
    getState,
  };
}