const MOTION_MAP = {
  idle_default: "000",
  idle_relaxing: "001",
  shy: "100",
  confident: "200",
  assertive: "201",
  excited: "400",
  angry: "300",
};

export function motionMapper(key) {
  return MOTION_MAP[key] ?? MOTION_MAP.idle_default;
}