import battleChartConfig from "../shared/battle_chart_config.json";

export const APP_CONFIG = {
  // Fallback loss file path (used as display label in BattlePanel).
  // When training is active, the actual path comes from the /api/battle/loss
  // response and overrides this default.
  lossFilePath: "../data/loss.txt",
  lossPollIntervalMs: 2000,
  battleCharts: battleChartConfig,
};
