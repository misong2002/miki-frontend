export const AppMode = {
  CHAT: "chat",
  TRANSFORMING: "transforming",
  TRAINING: "training",
  BATTLE: "battle",
};

export const initialHyperParams = {
  modelName: "hadron_Matrix_siren",
  dataset: "data/simulation.hdf5",
  flux: "data/flux.dat",
  output: "data/siren_params.npz",
  rounds: 200,
  lr: 1e-3,
  layerSizes: "2,128,128,3",
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