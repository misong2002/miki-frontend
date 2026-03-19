const DEFAULT_FEATURE_POLICY = Object.freeze({
  rebound: {
    cooldownMs: 0,
    sameFeatureSuppressMs: 8_000,
    minEpochDelta: 0,
  },
  rapid_drop: {
    cooldownMs: 2_000,
    sameFeatureSuppressMs: 10_000,
    minEpochDelta: 1,
  },
  plateau: {
    cooldownMs: 4_000,
    sameFeatureSuppressMs: 25_000,
    minEpochDelta: 10,
  },
  stuck: {
    cooldownMs: 4_000,
    sameFeatureSuppressMs: 20_000,
    minEpochDelta: 8,
  },
  normal: {
    cooldownMs: 8_000,
    sameFeatureSuppressMs: 60_000,
    minEpochDelta: 20,
  },
  none: {
    cooldownMs: Infinity,
    sameFeatureSuppressMs: Infinity,
    minEpochDelta: Infinity,
  },
  default: {
    cooldownMs: 5_000,
    sameFeatureSuppressMs: 30_000,
    minEpochDelta: 0,
  },
});

function getPolicy(feature, featurePolicy) {
  if (!feature) return featurePolicy.default;
  return featurePolicy[feature] ?? featurePolicy.default;
}

export function createPerceptionGate({
  featurePolicy = DEFAULT_FEATURE_POLICY,
} = {}) {
  let lastEmitTime = 0;
  let lastEmitComment = null;
  let lastEmitFeature = null;
  let lastFeatureEmitTime = 0;
  let lastFeatureEpoch = null;

  function evaluate({
    comment,
    feature,
    epoch = null,
    now = Date.now(),
  }) {
    if (!comment || !String(comment).trim() || feature === "none") {
      return {
        emit: false,
        reason: "empty_or_none",
        now,
        feature,
        epoch,
        comment,
      };
    }

    const policy = getPolicy(feature, featurePolicy);

    if (now - lastEmitTime < policy.cooldownMs) {
      return {
        emit: false,
        reason: "global_cooldown",
        now,
        feature,
        epoch,
        comment,
        policy,
      };
    }

    if (comment === lastEmitComment) {
      return {
        emit: false,
        reason: "same_comment",
        now,
        feature,
        epoch,
        comment,
        policy,
      };
    }

    if (feature === lastEmitFeature) {
      if (now - lastFeatureEmitTime < policy.sameFeatureSuppressMs) {
        const epochDelta =
          Number.isFinite(epoch) && Number.isFinite(lastFeatureEpoch)
            ? epoch - lastFeatureEpoch
            : null;

        if (
          !Number.isFinite(epochDelta) ||
          epochDelta < (policy.minEpochDelta ?? 0)
        ) {
          return {
            emit: false,
            reason: "same_feature_suppressed",
            now,
            feature,
            epoch,
            comment,
            policy,
            epochDelta,
          };
        }
      }
    }

    return {
      emit: true,
      reason: "accepted",
      now,
      feature,
      epoch,
      comment,
      policy,
    };
  }

  function commit(decision) {
    if (!decision?.emit) return false;

    lastEmitTime = decision.now ?? Date.now();
    lastEmitComment = decision.comment ?? null;
    lastEmitFeature = decision.feature ?? null;
    lastFeatureEmitTime = decision.now ?? Date.now();
    lastFeatureEpoch = Number.isFinite(decision.epoch) ? decision.epoch : null;

    return true;
  }

  function accept(input) {
    const decision = evaluate(input);
    if (decision.emit) {
      commit(decision);
    }
    return decision;
  }

  function reset() {
    lastEmitTime = 0;
    lastEmitComment = null;
    lastEmitFeature = null;
    lastFeatureEmitTime = 0;
    lastFeatureEpoch = null;
  }

  function getState() {
    return {
      lastEmitTime,
      lastEmitComment,
      lastEmitFeature,
      lastFeatureEmitTime,
      lastFeatureEpoch,
      featurePolicy,
    };
  }

  return {
    evaluate,
    commit,
    accept,
    reset,
    getState,
  };
}