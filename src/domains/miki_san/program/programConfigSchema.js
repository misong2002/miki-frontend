export const TRAIN_CONFIG_SCHEMA_HINTS = Object.freeze({
  run_mode: {
    type: "enum",
    values: ["local", "cluster", "debug"],
  },
  "sections.model_config.model_name": {
    type: "string",
  },
  "sections.io_config.dataset_type": {
    type: "enum",
    values: ["local", "Doraemon"],
  },
  "sections.io_config.output": {
    type: "string",
  },
  "sections.io_config.flux": {
    type: "string",
  },
  "sections.local_dataset_config.dataset": {
    type: "string",
  },
  "sections.local_dataset_config.dataset_config": {
    type: "string",
  },
  "sections.local_dataset_config.loss_file": {
    type: "string",
  },
  "sections.doraemon_dataset_config.doraemon_generator": {
    type: "string",
  },
  "sections.doraemon_dataset_config.doraemon_oscillation": {
    type: "enum",
    values: ["osc", "unosc"],
  },
  "sections.doraemon_dataset_config.doraemon_flavor": {
    type: "enum",
    values: ["numu", "numubar", "nue", "nuebar"],
  },
  "sections.doraemon_dataset_config.doraemon_beam_mode": {
    type: "enum",
    values: ["FHC", "RHC"],
  },
  "sections.model_config.hidden_features": {
    type: "int",
  },
  "sections.model_config.hidden_layers": {
    type: "int",
  },
  "sections.model_config.outermost_linear": {
    type: "bool",
  },
  "sections.model_config.first_omega_0": {
    type: "number",
  },
  "sections.model_config.hidden_omega_0": {
    type: "number",
  },
  "sections.model_config.weight_gaussian_perturbation": {
    type: "number",
  },
  "sections.optimization_config.batch_size": {
    type: "int",
  },
  "sections.optimization_config.checkpoint_every": {
    type: "int",
  },
  "sections.optimization_config.log_every": {
    type: "int",
  },
  "sections.optimization_config.loss_mode": {
    type: "string",
  },
  "sections.optimization_config.loss_integration_grid": {
    type: "int",
  },
  "sections.optimization_config.loss_numerical_integration": {
    type: "enum",
    values: ["bin_sum", "adaptive", "gauss_legendre"],
  },
  "sections.optimization_config.lr": {
    type: "number",
  },
  "sections.optimization_config.rounds": {
    type: "int",
  },
  "sections.optimization_config.seed": {
    type: "int",
  },
  "sections.optimization_config.val_every": {
    type: "int",
  },
  "sections.cluster_config.queue": {
    type: "string",
  },
  "sections.cluster_config.nodes": {
    type: "int",
  },
  "sections.cluster_config.walltime": {
    type: "string",
  },
  "sections.debug_config.debug_sleep_ms": {
    type: "int",
  },
  "sections.debug_config.debug_steps": {
    type: "int",
  },
});
