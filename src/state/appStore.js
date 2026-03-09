export const AppMode = {
  CHAT: "chat",
  TRANSFORMING: "transforming",
  TRAINING: "training",
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