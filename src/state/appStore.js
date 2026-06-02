export const AppMode = {
  CHAT: "chat",
  TRANSFORMING: "transforming",
  TRAINING: "training",
  BATTLE: "battle",
};

// NOTE: initialHyperParams is partially deprecated. The actual training config
// is loaded from the backend via /api/train-config (see HyperParamPanel).
// These defaults serve as fallback only.
export const initialHyperParams = {
  modelName: "HMsiren",
  // --- SAYACA / HMSiren io ---
  dataset: "data/simulation.hdf5",
  flux: "data/flux.dat",
  output: "data/siren_params.npz",
  // --- SABER io (used when model_name = "SABER") ---
  benchmark_path: "",
  val_benchmark_path: "",
  test_benchmark_path: "",
  // --- common training ---
  rounds: 200,
  lr: 1e-3,
  hiddenFeatures: 128,
  hiddenLayers: 3,
  // --- SABER loss / training ---
  loss_type: "coarsened_shape_nll",
  density_mode: "linear_raw",
  negative_penalty_weight: 0.1,
  condition_number_max: "inf",
  training_mode: "full_coreset_full_integration",
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
  lossSourcePath: null,  // populated from /api/battle/loss response
};
