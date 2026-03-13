// miki_san/perception/perceptionModule.js
import { detectFeatures } from "./featureDetection.js";
import { getLatestComment } from "./commentor.js";
import { getRecentLossWindow } from "./windowUtils.js";
import { PERCEPTION_CONFIG } from "./perceptionConfig.js";

let PERCEPTION_INSTANCE_SEQ = 0;

export function createPerceptionModule() {
  const instanceId = ++PERCEPTION_INSTANCE_SEQ;

  const state = {
    plateauCount: 0,
    plateauMissCount: 0,
    stuckCount: 0,
    stuckMissCount: 0,
    idleCount: 0,
  };

  const PLATEAU_MISS_TOLERANCE = 2;
  const STUCK_MISS_TOLERANCE = 2;
  const NORMAL_TRIGGER_COUNT = 5;

  console.log(`[Perception Module] Created instance #${instanceId}`, {
    ...state,
  });

  function comment(lossData) {
    if (!lossData || lossData.length === 0) {
      return {
        comment: "暂无训练数据。",
        feature: "none",
        epoch: null,
      };
    }

    const recentWindow = getRecentLossWindow(lossData);
    const rawFeature = detectFeatures(recentWindow);

    console.log(`[Perception Module #${instanceId}] State before decision:`, {
      plateauCount: state.plateauCount,
      plateauMissCount: state.plateauMissCount,
      stuckCount: state.stuckCount,
      stuckMissCount: state.stuckMissCount,
      idleCount: state.idleCount,
      rawFeature,
      epoch: recentWindow[recentWindow.length - 1]?.epoch ?? null,
    });

    let finalFeature = "none";

    // ===== 快特征：立即放行 =====
    if (rawFeature === "rapid_drop" || rawFeature === "rebound") {
      finalFeature = rawFeature;

      state.plateauCount = 0;
      state.plateauMissCount = 0;
      state.stuckCount = 0;
      state.stuckMissCount = 0;
      state.idleCount = 0;
    }

    // ===== 慢特征：需要累计 =====
    else if (rawFeature === "plateau_candidate") {
      state.idleCount = 0;

      state.plateauCount += 1;
      state.plateauMissCount = 0;

      if (state.stuckCount > 0) {
        state.stuckMissCount += 1;
        if (state.stuckMissCount >= STUCK_MISS_TOLERANCE) {
          state.stuckCount = 0;
          state.stuckMissCount = 0;
        }
      }

      console.log(
        `[Perception Module #${instanceId}] Plateau Candidate Detected:`,
        { plateauCount: state.plateauCount }
      );

      if (state.plateauCount >= PERCEPTION_CONFIG.PLATEAU_TRIGGER_COUNT) {
        finalFeature = "plateau";
      }
    }

    else if (rawFeature === "stuck_candidate") {
      state.idleCount = 0;

      state.stuckCount += 1;
      state.stuckMissCount = 0;

      if (state.plateauCount > 0) {
        state.plateauMissCount += 1;
        if (state.plateauMissCount >= PLATEAU_MISS_TOLERANCE) {
          state.plateauCount = 0;
          state.plateauMissCount = 0;
        }
      }

      console.log(
        `[Perception Module #${instanceId}] Stuck Candidate Detected:`,
        { stuckCount: state.stuckCount }
      );

      if (state.stuckCount >= PERCEPTION_CONFIG.STUCK_TRIGGER_COUNT) {
        finalFeature = "stuck";
      }
    }

    else {
      // 非候选态时，对慢特征做衰减
      if (state.plateauCount > 0) {
        state.plateauMissCount += 1;
        if (state.plateauMissCount >= PLATEAU_MISS_TOLERANCE) {
          state.plateauCount = 0;
          state.plateauMissCount = 0;
        }
      }

      if (state.stuckCount > 0) {
        state.stuckMissCount += 1;
        if (state.stuckMissCount >= STUCK_MISS_TOLERANCE) {
          state.stuckCount = 0;
          state.stuckMissCount = 0;
        }
      }

      state.idleCount += 1;

      if (state.idleCount >= NORMAL_TRIGGER_COUNT) {
        state.idleCount = 0;
        finalFeature = "normal";
      }
    }

    console.log(`[Perception Module #${instanceId}] State after decision:`, {
      plateauCount: state.plateauCount,
      plateauMissCount: state.plateauMissCount,
      stuckCount: state.stuckCount,
      stuckMissCount: state.stuckMissCount,
      idleCount: state.idleCount,
      finalFeature,
      epoch: recentWindow[recentWindow.length - 1]?.epoch ?? null,
    });

    return getLatestComment(recentWindow, finalFeature);
  }

  function reset() {
    state.plateauCount = 0;
    state.plateauMissCount = 0;
    state.stuckCount = 0;
    state.stuckMissCount = 0;
    state.idleCount = 0;
  }

  function getState() {
    return { ...state, instanceId };
  }

  return {
    comment,
    reset,
    getState,
    instanceId,
  };
}