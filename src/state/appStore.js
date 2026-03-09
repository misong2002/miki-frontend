export const AppMode = {
  CHAT: "chat",
  TRANSFORMING: "transforming",
  TRAINING: "training",
  BATTLE: "battle",
};

export const initialHyperParams = {
  learningRate: 1e-3,
  batchSize: 64,
  epochs: 20,
  hiddenDim: 128,
};

export const initialTrainingState = {
  jobId: null,
  status: "idle",
  epoch: 0,
  step: 0,
  loss: null,
  logs: [],
  lossHistory: [],
};

export const initialBattleState = {
  contactMessages: [
    "……准备好了吗？这边就先顶上了。",
    "你那边盯好魔力波动，我来处理前线。",
    "站在我身后就好，正义的魔法少女会保护你哒！",
  ],
  lossData: [],
};