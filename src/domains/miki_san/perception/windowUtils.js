import { PERCEPTION_CONFIG } from "./perceptionConfig.js";

export function getRecentLossWindow(
  lossData,
  size = PERCEPTION_CONFIG.RECENT_WINDOW_SIZE
) {
  if (!Array.isArray(lossData)) return [];
  if (size <= 0) return [];
  return lossData.slice(-size);
}

export function toFiniteLossSeries(lossData) {
  if (!Array.isArray(lossData)) return [];

  return lossData
    .map((item) => ({
      ...item,
      loss: Number(item?.loss),
    }))
    .filter((item) => Number.isFinite(item.loss));
}

export function getLastEpoch(lossData) {
  if (!Array.isArray(lossData) || lossData.length === 0) return null;
  return lossData[lossData.length - 1]?.epoch ?? null;
}

export function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  return values.reduce((sum, x) => sum + x, 0) / values.length;
}

export function tail(values, size) {
  if (!Array.isArray(values) || size <= 0) return [];
  return values.slice(-size);
}

export function head(values, size) {
  if (!Array.isArray(values) || size <= 0) return [];
  return values.slice(0, size);
}