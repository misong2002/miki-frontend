import { commentTemplates } from "./commentTemplates.js";
import { getLastEpoch } from "./windowUtils.js";

export function getLatestComment(lossData, feature = "none") {
  const epoch = getLastEpoch(lossData);

  if (!Array.isArray(lossData) || lossData.length < 5) {
    return {
      comment: "训练刚开始，loss 数据不足。",
      feature: "none",
      epoch,
    };
  }

  const finalFeature = feature ?? "none";
  const comment = commentTemplates[finalFeature] ?? "训练状态正常。";

  return {
    comment,
    feature: finalFeature,
    epoch,
  };
}

/**
 * 向后兼容默认导出。
 * 这样无论上层是：
 *   import { getLatestComment } from "./commentor"
 * 还是：
 *   import getLatestComment from "./commentor"
 * 都能工作。
 */
export default getLatestComment;