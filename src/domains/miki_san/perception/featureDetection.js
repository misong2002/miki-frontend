import { PERCEPTION_CONFIG } from "./perceptionConfig.js";
import {
  toFiniteLossSeries,
  head,
  tail,
  mean,
} from "./windowUtils.js";

/**
 * 纯 detector：
 * - 输入：recent window
 * - 输出：raw feature
 *
 * 不做：
 * - 慢特征累计
 * - comment 生成
 * - 状态更新
 */
export function detectFeatures(lossData) {
  const series = toFiniteLossSeries(lossData);
  const N = series.length;

  if (N < PERCEPTION_CONFIG.MIN_POINTS) {
    return "none";
  }

  const losses = series.map((d) => d.loss);
  if (losses.length < PERCEPTION_CONFIG.MIN_POINTS) {
    return "none";
  }

  const firstLoss = losses[0];
  const lastLoss = losses[losses.length - 1];

  const maxLoss = Math.max(...losses);
  const minLoss = Math.min(...losses);
  const globalRange = Math.max(maxLoss - minLoss, 1e-8);

  const earlyValues = head(
    losses,
    Math.min(PERCEPTION_CONFIG.EARLY_SEGMENT_SIZE, losses.length)
  );
  const lateValues = tail(
    losses,
    Math.min(PERCEPTION_CONFIG.LATE_SEGMENT_SIZE, losses.length)
  );

  const earlyLossMean = mean(earlyValues);
  const lateLossMean = mean(lateValues);
  const meanLoss = mean(losses);

  if (
    !Number.isFinite(firstLoss) ||
    !Number.isFinite(lastLoss) ||
    !Number.isFinite(globalRange) ||
    !Number.isFinite(earlyLossMean) ||
    !Number.isFinite(lateLossMean) ||
    !Number.isFinite(meanLoss)
  ) {
    return "none";
  }

  /**
   * rebound:
   * 起点已经很低，但窗口里出现了显著抬升。
   */
  if (firstLoss < 0.3 * maxLoss && globalRange > firstLoss) {
    return "rebound";
  }

  /**
   * rapid_drop:
   * 末端显著低于开头，并且下降幅度相对整个窗口波动范围足够大。
   */
  if (
    lastLoss < 0.3 * firstLoss &&
    firstLoss - lastLoss > 0.2 * globalRange
  ) {
    return "rapid_drop";
  }

  /**
   * plateau_candidate:
   * 前后均值差不多，但整体 loss 基线高于波动尺度很多。
   */
  if (
    lateLossMean > earlyLossMean * 0.99 &&
    meanLoss > 3 * globalRange &&
    maxLoss > 1.05 * firstLoss
  ) {
    return "plateau_candidate";
  }

  /**
   * stuck_candidate:
   * 前后均值差不多，但整体波动幅度相对 mean 不算太小。
   */
  if (
    lateLossMean > earlyLossMean * 0.99 &&
    meanLoss < 3 * globalRange &&
    maxLoss > 1.1 * firstLoss
  ) {
    return "stuck_candidate";
  }

  return "normal_candidate";
}