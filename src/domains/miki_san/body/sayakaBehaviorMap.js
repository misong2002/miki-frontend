export const SAYAKA_EXPRESSIONS = {
  "10": {
    file: "mtn_ex_010.exp3.json",
    label: "blushSmile",
    note: "脸红微笑",
  },
  "11": {
    file: "mtn_ex_011.exp3.json",
    label: "calmSmile",
    note: "平静微笑",
  },
  "20": {
    file: "mtn_ex_020.exp3.json",
    label: "angry",
    note: "生气",
  },
  "30": {
    file: "mtn_ex_030.exp3.json",
    label: "worried",
    note: "担心",
  },
  "40": {
    file: "mtn_ex_040.exp3.json",
    label: "shy",
    note: "害羞",
  },
  "41": {
    file: "mtn_ex_041.exp3.json",
    label: "shyLaugh",
    note: "害羞笑/尴尬",
  },
  "50": {
    file: "mtn_ex_050.exp3.json",
    label: "focused",
    note: "平淡专注",
  },
  "60": {
    file: "mtn_ex_060.exp3.json",
    label: "righteousAnger",
    note: "义愤/激昂",
  },
};

export const SAYAKA_MOTIONS = {
  "000": {
    file: "motion_000.motion3.json",
    label: "idle",
    note: "平常站立",
  },
  "001": {
    file: "motion_001.motion3.json",
    label: "relaxed",
    note: "叉腰向右倚",
  },
  "100": {
    file: "motion_100.motion3.json",
    label: "embarrassed",
    note: "摸后脑勺",
  },
  "200": {
    file: "motion_200.motion3.json",
    label: "thinking",
    note: "叉腰向左倚",
  },
  "201": {
    file: "motion_201.motion3.json",
    label: "assertive",
    note: "叉腰并顶一下手肘",
  },
  "300": {
    file: "motion_300.motion3.json",
    label: "angry",
    note: "双手背后猛地直立",
  },
  "400": {
    file: "motion_400.motion3.json",
    label: "excited",
    note: "右手收胸前左手展开",
  },
};

export const SAYAKA_BEHAVIOR = {
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
};