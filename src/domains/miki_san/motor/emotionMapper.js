const EMOTION_MAP = {
  neutral: 50,
  speaking: 11,
  smile: 10,
  calm_smile: 11,
  angry: 20,
  worried: 30,
  shy: 40,
  shy_smile: 41,
  focused: 50,
  righteous_anger: 60,
};

export function emotionMapper(key) {
  return EMOTION_MAP[key] ?? EMOTION_MAP.neutral;
}