// perception/featureDetection.js
import { PERCEPTION_CONFIG } from "./perceptionConfig.js";

/**
 * 检测 loss 曲线特征（无状态）
 * 输入数据应当已经是统一截取后的 recent window
 */
export function detectFeatures(lossData) {
  const N = lossData?.length ?? 0;
  if (!lossData || N < PERCEPTION_CONFIG.MIN_POINTS) return "none";

  const losses = lossData.map((d) => Number(d.loss)).filter(Number.isFinite);
  if (losses.length < PERCEPTION_CONFIG.MIN_POINTS) return "normal_candidate";

  const maxLoss = Math.max(...losses);
  const minLoss = Math.min(...losses);
  const globalRange = Math.max(maxLoss - minLoss, 1e-8);

  const firstLoss = losses[0];
  const lastLoss = losses[losses.length - 1];

  const meanLoss = losses.reduce((a, b) => a + b, 0) / losses.length;
  const slope = (lastLoss - firstLoss);

  if (firstLoss < 0.3 * maxLoss && globalRange > firstLoss) {
    // console.log("[Feature Detection]: Rebound Detected", {
    //   firstLoss,
    //   lastLoss,
    //   maxLoss,
    //   minLoss,
    //   globalRange,
    // });
    return "rebound";
  }

  if (
    lastLoss < 0.3 * firstLoss &&
    firstLoss - lastLoss > 0.2 * globalRange
  ) {
    // console.log("[Feature Detection]: Rapid Drop Detected", {
    //   firstLoss,
    //   lastLoss,
    //   globalRange,
    // });
    return "rapid_drop";
  }

  if (Math.abs(slope) < 0.01 && meanLoss > 3 * globalRange) {
    // console.log("[Feature Detection]: Plateau Candidate Detected", {
    //   slope,
    //   meanLoss,
    //   globalRange,
    // });
    return "plateau_candidate";
  }

  if (Math.abs(slope) < 1 && meanLoss < 3 * globalRange) {
    // console.log("[Feature Detection]: Stuck Candidate Detected", {
    //   slope,
    //   meanLoss,
    //   globalRange,
    // });
    return "stuck_candidate";
  }

  return "normal_candidate";
}