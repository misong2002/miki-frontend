import {
  SAYAKA_EXPRESSION_DEFS,
  SAYAKA_MOTION_DEFS,
} from "./sayakaCatalog";

export const SAYAKA_BEHAVIOR = Object.freeze({
  neutral: {
    expression: "50",
    motion: "000",
  },
  thinking: {
    expression: "30",
    motion: "201",
  },
  explaining: {
    expression: "50",
    motion: "201",
  },
  happy: {
    expression: "11",
    motion: "400",
  },
  shy: {
    expression: "40",
    motion: "100",
  },
  surprised: {
    expression: "41",
    motion: "400",
  },
  worried: {
    expression: "30",
    motion: "200",
  },
  angry: {
    expression: "20",
    motion: "300",
  },
  righteous: {
    expression: "60",
    motion: "201",
  },
});

/**
 * 向后兼容：
 * 以前这个文件里也直接导出完整 expression/motion catalog。
 * 现在统一从 sayakaCatalog 派生，避免双份真相源。
 */
export const SAYAKA_EXPRESSIONS = SAYAKA_EXPRESSION_DEFS;
export const SAYAKA_MOTIONS = SAYAKA_MOTION_DEFS;

export function getBehaviorPreset(name) {
  return SAYAKA_BEHAVIOR[name] ?? null;
}