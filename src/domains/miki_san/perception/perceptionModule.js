import { detectFeatures } from "./featureDetection.js";
import { getLatestComment } from "./commentor.js";
import { getRecentLossWindow } from "./windowUtils.js";
import {
  createInitialFeatureState,
  advanceFeatureState,
} from "./featureStateMachine.js";

let PERCEPTION_INSTANCE_SEQ = 0;

export function createPerceptionModule({
  config,
  detect = detectFeatures,
  commentor = getLatestComment,
  selectWindow = getRecentLossWindow,
} = {}) {
  const instanceId = ++PERCEPTION_INSTANCE_SEQ;
  const state = createInitialFeatureState();

  function comment(lossData) {
    if (!Array.isArray(lossData) || lossData.length === 0) {
      return {
        comment: "暂无训练数据。",
        feature: "none",
        rawFeature: "none",
        epoch: null,
      };
    }

    const recentWindow = selectWindow(lossData);
    const rawFeature = detect(recentWindow);
    const finalFeature = advanceFeatureState(
      state,
      rawFeature,
      config
    );

    const result = commentor(recentWindow, finalFeature);

    return {
      ...result,
      rawFeature,
      state: getState(),
    };
  }

  function reset() {
    const next = createInitialFeatureState();
    state.plateauCount = next.plateauCount;
    state.plateauMissCount = next.plateauMissCount;
    state.stuckCount = next.stuckCount;
    state.stuckMissCount = next.stuckMissCount;
    state.idleCount = next.idleCount;
  }

  function getState() {
    return {
      instanceId,
      plateauCount: state.plateauCount,
      plateauMissCount: state.plateauMissCount,
      stuckCount: state.stuckCount,
      stuckMissCount: state.stuckMissCount,
      idleCount: state.idleCount,
    };
  }

  return {
    comment,
    reset,
    getState,
    instanceId,
  };
}