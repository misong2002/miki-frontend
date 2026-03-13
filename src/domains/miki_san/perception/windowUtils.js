import { PERCEPTION_CONFIG } from "./perceptionConfig.js";

export function getRecentLossWindow(
  lossData,
  size = PERCEPTION_CONFIG.RECENT_WINDOW_SIZE
) {
  if (!Array.isArray(lossData)) return [];
  return lossData.slice(-size);
}