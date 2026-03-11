// src/features/character/types.js

export const CharacterEventType = {
  APP_MODE_CHANGED: "APP_MODE_CHANGED",

  CHAT_START: "CHAT_START",
  CHAT_TOKEN: "CHAT_TOKEN",
  CHAT_CONTROL_EMOTION: "CHAT_CONTROL_EMOTION",
  CHAT_CONTROL_MOTION: "CHAT_CONTROL_MOTION",
  CHAT_END: "CHAT_END",

  TRAINING_STATUS: "TRAINING_STATUS",

  USER_ACTIVE: "USER_ACTIVE",
  TICK: "TICK",
};

export const CharacterSource = {
  IDLE: "idle",
  CHAT: "chat",
  TRAINING: "training",
  SYSTEM: "system",
};

export function makeIntent({
  source,
  priority = 0,
  emotion = null,
  motion = null,
  speech = false,
  interruptible = true,
  durationMs = null,
}) {
  return {
    source,
    priority,
    emotion,
    motion,
    speech,
    interruptible,
    durationMs,
    createdAt: Date.now(),
  };
}


export function createInitialCharacterState() {
  return {
    appMode: "chat",

    activeIntent: null,

    chat: {
      streaming: false,
      lastTokenAt: 0,
      pendingEmotion: null,
      pendingMotion: null,
    },

    training: {
      status: "idle", // idle | running | completed | error
      semantic: "idle",
    },

    idle: {
      enabled: true,
      lastActiveAt: Date.now(),
    },
  };
}

export const CharacterCommandType = {
  SET_EMOTION: "SET_EMOTION",
  PLAY_MOTION: "PLAY_MOTION",
  SET_SPEECH: "SET_SPEECH",
  STOP_SPEECH: "STOP_SPEECH",
};