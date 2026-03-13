// perception/commentor.js
import { detectFeatures } from "./featureDetection.js";

import { commentTemplates } from "./commentTemplates.js";

export function getLatestComment(lossData, finalFeature = null) {
  if (!lossData || lossData.length < 5) {
    return {
      comment: "训练刚开始，loss 数据不足。",
      feature: "none",
      epoch: lossData?.length ? lossData[lossData.length - 1].epoch : null,
    };
  }

  const feature = finalFeature ?? detectFeatures(lossData);
  const comment = commentTemplates[feature] ?? "训练状态正常。";
  const epoch = lossData[lossData.length - 1]?.epoch ?? null;

  // console.log("[Commentor]:", {
  //   feature,
  //   comment,
  //   epoch,
  // });

  return {
    comment,
    feature,
    epoch,
  };
}