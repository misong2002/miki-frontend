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
    {
      id: "battle-init-1",
      content:  "（语音频道初始化中……）",
      createdAt: Date.now(),
      epoch: null,
    },
  ],
  lossData: [],
  lossMeta: null,
};
