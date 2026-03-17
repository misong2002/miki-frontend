export const PERCEPTION_CONFIG = {
  /**
   * 每次感知只看最近多少个点。
   */
  RECENT_WINDOW_SIZE: 200,

  /**
   * detector 内部所需的最小点数。
   */
  MIN_POINTS: 20,

  /**
   * detector 里做局部统计时的默认窗口。
   */
  EARLY_SEGMENT_SIZE: 50,
  LATE_SEGMENT_SIZE: 50,

  /**
   * 慢特征累计触发阈值。
   */
  PLATEAU_TRIGGER_COUNT: 4,
  STUCK_TRIGGER_COUNT: 5,

  /**
   * 候选态断续时，允许 miss 的次数。
   */
  PLATEAU_MISS_TOLERANCE: 2,
  STUCK_MISS_TOLERANCE: 2,

  /**
   * 长时间没有快特征/慢特征命中时，
   * 每累计多少次 normal_candidate 放一个 normal。
   */
  NORMAL_TRIGGER_COUNT: 5,
};