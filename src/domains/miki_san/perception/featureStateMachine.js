import { PERCEPTION_CONFIG } from "./perceptionConfig.js";

export function createInitialFeatureState() {
  return {
    plateauCount: 0,
    plateauMissCount: 0,
    stuckCount: 0,
    stuckMissCount: 0,
    idleCount: 0,
  };
}

function resetPlateau(state) {
  state.plateauCount = 0;
  state.plateauMissCount = 0;
}

function resetStuck(state) {
  state.stuckCount = 0;
  state.stuckMissCount = 0;
}

function resetIdle(state) {
  state.idleCount = 0;
}

function resetAll(state) {
  resetPlateau(state);
  resetStuck(state);
  resetIdle(state);
}

export function advanceFeatureState(state, rawFeature, config = PERCEPTION_CONFIG) {
  let finalFeature = "none";

  if (rawFeature === "rapid_drop" || rawFeature === "rebound") {
    finalFeature = rawFeature;
    resetAll(state);
    return finalFeature;
  }

  if (rawFeature === "plateau_candidate") {
    resetIdle(state);

    state.plateauCount += 1;
    state.plateauMissCount = 0;

    if (state.stuckCount > 0) {
      state.stuckMissCount += 1;
      if (state.stuckMissCount >= config.STUCK_MISS_TOLERANCE) {
        resetStuck(state);
      }
    }

    if (state.plateauCount >= config.PLATEAU_TRIGGER_COUNT) {
      finalFeature = "plateau";
    }

    return finalFeature;
  }

  if (rawFeature === "stuck_candidate") {
    resetIdle(state);

    state.stuckCount += 1;
    state.stuckMissCount = 0;

    if (state.plateauCount > 0) {
      state.plateauMissCount += 1;
      if (state.plateauMissCount >= config.PLATEAU_MISS_TOLERANCE) {
        resetPlateau(state);
      }
    }

    if (state.stuckCount >= config.STUCK_TRIGGER_COUNT) {
      finalFeature = "stuck";
    }

    return finalFeature;
  }

  /**
   * 非候选态：
   * - 慢特征做衰减
   * - normal_candidate 累积到一定次数才放 normal
   */
  if (state.plateauCount > 0) {
    state.plateauMissCount += 1;
    if (state.plateauMissCount >= config.PLATEAU_MISS_TOLERANCE) {
      resetPlateau(state);
    }
  }

  if (state.stuckCount > 0) {
    state.stuckMissCount += 1;
    if (state.stuckMissCount >= config.STUCK_MISS_TOLERANCE) {
      resetStuck(state);
    }
  }

  if (rawFeature === "normal_candidate") {
    state.idleCount += 1;

    if (state.idleCount >= config.NORMAL_TRIGGER_COUNT) {
      state.idleCount = 0;
      finalFeature = "normal";
    }

    return finalFeature;
  }

  resetIdle(state);
  return finalFeature;
}