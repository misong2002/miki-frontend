const EXPRESSION_DEFS = Object.freeze({
  "10": {
    id: "10",
    file: "mtn_ex_010.exp3.json",
    label: "blushSmile",
    note: "脸红微笑",
  },
  "11": {
    id: "11",
    file: "mtn_ex_011.exp3.json",
    label: "calmSmile",
    note: "平静微笑",
  },
  "20": {
    id: "20",
    file: "mtn_ex_020.exp3.json",
    label: "angry",
    note: "生气",
  },
  "30": {
    id: "30",
    file: "mtn_ex_030.exp3.json",
    label: "worried",
    note: "担心",
  },
  "40": {
    id: "40",
    file: "mtn_ex_040.exp3.json",
    label: "shy",
    note: "害羞",
  },
  "41": {
    id: "41",
    file: "mtn_ex_041.exp3.json",
    label: "shyLaugh",
    note: "害羞笑/尴尬",
  },
  "50": {
    id: "50",
    file: "mtn_ex_050.exp3.json",
    label: "focused",
    note: "平淡专注",
  },
  "60": {
    id: "60",
    file: "mtn_ex_060.exp3.json",
    label: "righteousAnger",
    note: "义愤/激昂",
  },
});

const MOTION_DEFS = Object.freeze({
  "000": {
    id: "000",
    file: "motion_000.motion3.json",
    label: "idle",
    note: "平常站立",
  },
  "001": {
    id: "001",
    file: "motion_001.motion3.json",
    label: "relaxed",
    note: "叉腰向右倚",
  },
  "100": {
    id: "100",
    file: "motion_100.motion3.json",
    label: "embarrassed",
    note: "摸后脑勺",
  },
  "200": {
    id: "200",
    file: "motion_200.motion3.json",
    label: "thinking",
    note: "叉腰向左倚",
  },
  "201": {
    id: "201",
    file: "motion_201.motion3.json",
    label: "assertive",
    note: "叉腰并顶一下手肘",
  },
  "300": {
    id: "300",
    file: "motion_300.motion3.json",
    label: "angry",
    note: "双手背后猛地直立",
  },
  "400": {
    id: "400",
    file: "motion_400.motion3.json",
    label: "excited",
    note: "右手收胸前左手展开",
  },
});

function toFileMap(defs) {
  return Object.fromEntries(
    Object.entries(defs).map(([id, meta]) => [id, meta.file])
  );
}

function toLabelMap(defs) {
  return Object.fromEntries(
    Object.entries(defs).map(([id, meta]) => [id, meta.label])
  );
}

export const SAYAKA_EXPRESSION_DEFS = EXPRESSION_DEFS;
export const SAYAKA_MOTION_DEFS = MOTION_DEFS;

/**
 * 向后兼容：
 * 旧代码里 live2dController 直接拿 id -> fileName 映射。
 */
export const SAYAKA_EXPRESSIONS = Object.freeze(toFileMap(EXPRESSION_DEFS));
export const SAYAKA_MOTIONS = Object.freeze(toFileMap(MOTION_DEFS));

export const SAYAKA_EXPRESSION_LABELS = Object.freeze(toLabelMap(EXPRESSION_DEFS));
export const SAYAKA_MOTION_LABELS = Object.freeze(toLabelMap(MOTION_DEFS));

export const SAYAKA_IDLE_EXPRESSION_IDS = Object.freeze(["50", "11"]);
export const SAYAKA_IDLE_MOTION_IDS = Object.freeze(["000", "001"]);

export function getExpressionMetaById(expressionId) {
  return EXPRESSION_DEFS[String(expressionId)] ?? null;
}

export function getMotionMetaById(motionId) {
  return MOTION_DEFS[String(motionId)] ?? null;
}

export function getExpressionFileById(expressionId) {
  return getExpressionMetaById(expressionId)?.file ?? null;
}

export function getMotionFileById(motionId) {
  return getMotionMetaById(motionId)?.file ?? null;
}

export function hasExpressionId(expressionId) {
  return !!getExpressionMetaById(expressionId);
}

export function hasMotionId(motionId) {
  return !!getMotionMetaById(motionId);
}