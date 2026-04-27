import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchTrainConfig,
  saveTrainConfig,
} from "../services/trainConfigService";
import {
  fetchHistorySessions,
  runHistoryInitialize,
  runHistoryPlot,
} from "../services/historyToolService";
import PlotImageBrowser from "./PlotImageBrowser";

const RUN_MODE_OPTIONS = ["local", "cluster", "debug"];
const LOSS_NUMERICAL_INTEGRATION_OPTIONS = [
  { value: "bin_sum", label: "bin_sum" },
  { value: "adaptive", label: "adaptive" },
  { value: "gauss_legendre", label: "gauss-legendre" },
];
const RUN_MODE_TAB_ID = "run_mode";
const PRIMARY_CONFIG_TABS = ["io_config", "model_config", "optimization_config"];
const CONFIG_SECTION_ORDER = [
  "io_config",
  "model_config",
  "optimization_config",
  "cluster_config",
  "debug_config",
];
const RUN_MODE_SECTION_BY_MODE = {
  cluster: "cluster_config",
  debug: "debug_config",
};
const SECTION_LABELS = {
  io_config: "io",
  model_config: "model",
  optimization_config: "optimization",
};
const SECTION_TITLES = {
  io_config: "IO Config",
  model_config: "Model Config",
  optimization_config: "Optimization Config",
  cluster_config: "Cluster Config",
  debug_config: "Debug Config",
};
const OPTIMIZATION_INTEGRATION_KEYS = new Set([
  "loss_numerical_integration",
  "loss_integration_configs",
]);
const OPTIMIZATION_INTEGRATION_DEFAULTS = {
  loss_numerical_integration: "bin_sum",
};
const INTEGRATION_MODE_DEFAULTS = {
  bin_sum: {
    loss_input1_min: -1,
    loss_input1_max: 1,
    loss_input2_min: -1,
    loss_input2_max: 1,
    loss_input1_bins: 108,
    loss_input2_bins: 108,
    num_E_nu_bins: 50,
  },
  adaptive: {
    loss_input1_min: -1,
    loss_input1_max: 1,
    loss_input2_min: -1,
    loss_input2_max: 1,
    loss_input1_bins: 108,
    loss_input2_bins: 108,
    num_E_nu_bins: 50,
    adaptive_max_depth: 10,
    adaptive_min_events: 50,
  },
  gauss_legendre: {
    loss_input1_min: -1,
    loss_input1_max: 1,
    loss_input2_min: -1,
    loss_input2_max: 1,
    num_E_nu_bins: 50,
    gauss_legendre_input1_order: 108,
    gauss_legendre_input2_order: 108,
  },
};
const INTEGRATION_MODE_FIELD_LABELS = {
  loss_input1_min: "input1_min",
  loss_input1_max: "input1_max",
  loss_input2_min: "input2_min",
  loss_input2_max: "input2_max",
  loss_input1_bins: "input1_bins",
  loss_input2_bins: "input2_bins",
  num_E_nu_bins: "E_nu_bins",
  adaptive_max_depth: "adaptive_max_depth",
  adaptive_min_events: "adaptive_min_events",
  gauss_legendre_input1_order: "input1_order",
  gauss_legendre_input2_order: "input2_order",
};
const LOSS_GRID_COORDINATES = {
  linear: {
    input1: { name: "x", unit: "unitless", defaultRange: [0.0, 3.0] },
    input2: { name: "Q^2", unit: "GeV^2", defaultRange: [0.0, 15.0] },
  },
  log: {
    input1: { name: "x", unit: "unitless", defaultRange: [0.0, 3.0] },
    input2: { name: "log(Q^2)", unit: "unitless", defaultRange: [-6.0, 2.0] },
  },
  sqrt: {
    input1: { name: "sqrt(x)", unit: "unitless", defaultRange: [0.0, 2.0] },
    input2: { name: "sqrt(Q^2)", unit: "GeV", defaultRange: [0.0, 4.0] },
  },
  v1v2: {
    input1: { name: "log(sqrt(Q^2 / x))", unit: "unitless", defaultRange: [-2.0, 2.0] },
    input2: { name: "sqrt(Q^2)", unit: "GeV", defaultRange: [0.0, 4.0] },
  },
};

function inferInputKind(value) {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value) || (value && typeof value === "object")) return "json";
  return "text";
}

function toDisplayValue(value) {
  if (Array.isArray(value) || (value && typeof value === "object")) {
    return JSON.stringify(value, null, 2);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return value ?? "";
}

function valueOrDefault(section, key) {
  const value = section?.[key];
  return value === undefined || value === null || value === ""
    ? OPTIMIZATION_INTEGRATION_DEFAULTS[key]
    : value;
}

function normalizeIntegrationMode(value) {
  return String(value || "bin_sum") === "gauss-legendre"
    ? "gauss_legendre"
    : String(value || "bin_sum");
}

function normalizeLossIntegrationGrid(value) {
  const grid = String(value || "log").trim().toLowerCase();
  if (["logarithmic", "logspace", "x_logq2", "x-logq2"].includes(grid)) return "log";
  if (["lin", "linspace", "xq2", "xq2_linear", "x_q2", "x-q2"].includes(grid)) return "linear";
  if (["sqrt_x_q2", "sqrt_xq2"].includes(grid)) return "sqrt";
  if (["v1_v2", "v1-v2"].includes(grid)) return "v1v2";
  return LOSS_GRID_COORDINATES[grid] ? grid : "log";
}

function unitSuffix(unit) {
  return unit && unit !== "unitless" ? ` [${unit}]` : "";
}

function formatCoordinateSummary(axis, coordinate) {
  return `${axis}: ${coordinate.name}${unitSuffix(coordinate.unit)}`;
}

function formatDefaultRange(coordinate) {
  return `default: ${coordinate.name} ${coordinate.defaultRange[0]} to ${coordinate.defaultRange[1]}${unitSuffix(coordinate.unit)}`;
}

function integrationFieldLabel(key, coordinates) {
  const axisMatch = key.match(/(?:loss_|gauss_legendre_)?input([12])_(min|max|bins|order)$/);
  if (!axisMatch) return INTEGRATION_MODE_FIELD_LABELS[key] ?? key;

  const coordinate = coordinates[`input${axisMatch[1]}`];
  const suffix = axisMatch[2];
  return `${coordinate?.name ?? `input${axisMatch[1]}`}_${suffix}`;
}

function integrationFieldHint(key, coordinates) {
  if (key === "loss_input1_min" || key === "loss_input1_max") {
    return formatDefaultRange(coordinates.input1);
  }
  if (key === "loss_input2_min" || key === "loss_input2_max") {
    return formatDefaultRange(coordinates.input2);
  }
  return "";
}

function integrationConfigFor(section, mode) {
  const normalizedMode = normalizeIntegrationMode(mode);
  const configs = section?.loss_integration_configs;
  const modeConfig = configs && typeof configs === "object" ? configs[normalizedMode] : null;
  return {
    ...(INTEGRATION_MODE_DEFAULTS[normalizedMode] ?? {}),
    ...(modeConfig && typeof modeConfig === "object" ? modeConfig : {}),
  };
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveInteger(value, fallback = 1) {
  return Math.max(1, Math.floor(finiteNumber(value, fallback)));
}

function compactNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(number);
}

function parseEditedValue(rawValue, originalValue) {
  const kind = inferInputKind(originalValue);

  if (kind === "number") {
    const num = Number(rawValue);
    if (Number.isNaN(num)) {
      throw new Error(`invalid number: ${rawValue}`);
    }
    return num;
  }

  if (kind === "boolean") {
    const lowered = String(rawValue).trim().toLowerCase();
    if (lowered === "true") return true;
    if (lowered === "false") return false;
    throw new Error(`invalid boolean: ${rawValue}`);
  }

  if (kind === "json") {
    return JSON.parse(rawValue);
  }

  return rawValue;
}

function toSessionLabel(item) {
  if (!item) return "";
  if (typeof item === "string") return item;
  if (item.label) return item.label;
  if (item.path) return item.path;
  if (item.session_id) return `history/${item.session_id}`;
  return "";
}

function toSessionId(item) {
  if (!item) return "";
  if (typeof item === "string") {
    return item.replace(/^history\//, "");
  }
  return item.session_id ?? "";
}

function splitHistorySessionId(sessionId) {
  const value = String(sessionId || "").replace(/^history\//, "");
  const [timestamp = "", epoch = ""] = value.split("/");
  return { timestamp, epoch };
}

function historyTimestampOf(item) {
  if (!item) return "";
  if (typeof item === "object" && item.timestamp) return item.timestamp;
  return splitHistorySessionId(toSessionId(item)).timestamp;
}

function historyEpochOf(item) {
  if (!item) return "";
  if (typeof item === "object" && item.epoch) return item.epoch;
  return splitHistorySessionId(toSessionId(item)).epoch;
}

function groupHistorySessions(sessions) {
  const groupsByTimestamp = new Map();

  for (const item of sessions) {
    const sessionId = toSessionId(item);
    const timestamp = historyTimestampOf(item);
    if (!sessionId || !timestamp) continue;

    if (!groupsByTimestamp.has(timestamp)) {
      groupsByTimestamp.set(timestamp, {
        timestamp,
        entries: [],
      });
    }

    groupsByTimestamp.get(timestamp).entries.push({
      item,
      sessionId,
      epoch: historyEpochOf(item),
      label: toSessionLabel(item),
    });
  }

  const groups = [...groupsByTimestamp.values()];
  for (const group of groups) {
    group.entries.sort((a, b) => {
      const aKey = historyLeafSortKey(a.epoch);
      const bKey = historyLeafSortKey(b.epoch);
      return (
        bKey.lossEpoch - aKey.lossEpoch
        || bKey.modelEpoch - aKey.modelEpoch
        || bKey.suffix - aKey.suffix
        || b.sessionId.localeCompare(a.sessionId)
      );
    });
  }

  groups.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return groups;
}

function historyLeafSortKey(name) {
  const text = String(name || "");
  const match = text.match(/^epoch(\d+)\(model on epoch (\d+)\)(?:_(\d+))?$/);
  if (match) {
    return {
      lossEpoch: Number(match[1]),
      modelEpoch: Number(match[2]),
      suffix: Number(match[3] || 0),
    };
  }
  if (/^\d+$/.test(text)) {
    return {
      lossEpoch: Number(text),
      modelEpoch: 0,
      suffix: 0,
    };
  }
  return {
    lossEpoch: -1,
    modelEpoch: -1,
    suffix: -1,
  };
}

function titleFromSectionName(sectionName) {
  return SECTION_TITLES[sectionName] ?? sectionName.replace(/_/g, " ");
}

function getOrderedSectionNames(sections) {
  const sectionNames = sections && typeof sections === "object" ? Object.keys(sections) : [];
  return [
    ...CONFIG_SECTION_ORDER.filter((sectionName) => sectionNames.includes(sectionName)),
    ...sectionNames.filter((sectionName) => !CONFIG_SECTION_ORDER.includes(sectionName)),
  ];
}

function getConfigTabs() {
  return [
    ...PRIMARY_CONFIG_TABS.map((sectionName) => ({
      id: sectionName,
      label: SECTION_LABELS[sectionName] ?? sectionName.replace(/_config$/, "").replace(/_/g, " "),
    })),
    { id: RUN_MODE_TAB_ID, label: "run_mode" },
  ];
}

function normalizeConfig(config) {
  const sections = config?.sections && typeof config.sections === "object" ? config.sections : {};
  const normalizedSections = {};

  for (const sectionName of getOrderedSectionNames(sections)) {
    normalizedSections[sectionName] =
      sections[sectionName] && typeof sections[sectionName] === "object"
        ? sections[sectionName]
        : {};
  }

  for (const sectionName of CONFIG_SECTION_ORDER) {
    if (!normalizedSections[sectionName]) {
      normalizedSections[sectionName] = {};
    }
  }

  return {
    run_mode: config?.run_mode ?? "local",
    sections: normalizedSections,
  };
}

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(normalizeConfig(config)));
}

const rootStyle = {
  display: "grid",
  gridTemplateRows: "2fr 3fr",
  gap: 12,
  minHeight: 0,
  height: "100%",
};

const subPanelStyle = {
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  padding: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 12,
  background: "rgba(255,255,255,0.03)",
  overflow: "hidden",
};

const historyPanelStyle = {
  ...subPanelStyle,
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr) auto auto auto",
  rowGap: 0,
};

const subHeaderStyle = {
  marginBottom: 10,
  flex: "0 0 auto",
};

const subTitleStyle = {
  fontSize: "1rem",
  margin: 0,
};

const subSubtitleStyle = {
  fontSize: "0.85rem",
  opacity: 0.8,
  marginTop: 4,
};

const actionRowStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 12,
  flex: "0 0 auto",
};

const historySelectWrapStyle = {
  minHeight: 0,
  flex: "1 1 auto",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const historyLabelStyle = {
  flex: "0 0 auto",
};

const historyTreeStyle = {
  width: "100%",
  flex: "1 1 auto",
  minHeight: 0,
  maxHeight: "100%",
  overflowY: "auto",
  overflowX: "hidden",
  display: "block",
  padding: 2,
  boxSizing: "border-box",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  background: "rgba(255,255,255,0.02)",
};

const historyGroupStyle = {
  display: "block",
  margin: 0,
  padding: 0,
};

const historyRowStyle = {
  width: "100%",
  height: 32,
  minHeight: 32,
  maxHeight: 32,
  flex: "none",
  lineHeight: "20px",
  margin: 0,
  padding: "6px 8px",
  border: 0,
  borderRadius: 4,
  background: "transparent",
  color: "inherit",
  textAlign: "left",
  cursor: "pointer",
  boxSizing: "border-box",
  appearance: "none",
  display: "flex",
  alignItems: "center",
  gap: 6,
  overflow: "hidden",
  transform: "none",
};

const historyRowActiveStyle = {
  background: "rgba(125, 211, 252, 0.16)",
  boxShadow: "inset 0 0 0 1px rgba(125, 211, 252, 0.48)",
};

const historyTimestampButtonActiveStyle = {
  ...historyRowActiveStyle,
};

const historyTreeIconStyle = {
  width: 14,
  flex: "0 0 14px",
  opacity: 0.78,
  textAlign: "center",
};

const historyEpochButtonStyle = {
  ...historyRowStyle,
  paddingLeft: 28,
  color: "rgba(31, 53, 84, 0.92)",
};

const historyEpochButtonActiveStyle = {
  background: "rgba(134, 239, 172, 0.14)",
  boxShadow: "inset 0 0 0 1px rgba(134, 239, 172, 0.46)",
};

const historyRowTextStyle = {
  minWidth: 0,
  flex: 1,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  lineHeight: "20px",
};

const configScrollStyle = {
  minHeight: 0,
  flex: 1,
  overflow: "auto",
  paddingRight: 4,
  border: "1px solid rgba(255,255,255,0.12)",
  borderTop: 0,
  background: "rgba(255,255,255,0.02)",
};

const feedbackSlotStyle = {
  minHeight: 22,
  marginTop: 8,
  flex: "0 0 auto",
};

const tabRowStyle = {
  display: "grid",
  gap: 0,
  flex: "0 0 auto",
};

const sectionBlockStyle = {
  padding: 12,
  borderBottom: "1px solid rgba(255,255,255,0.08)",
};

const sectionTitleStyle = {
  margin: "0 0 10px 0",
  fontSize: "0.9rem",
  opacity: 0.95,
};

const runModeSelectStyle = {
  width: "100%",
};

const integrationGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 10,
};

const integrationEstimatorStyle = {
  marginTop: 12,
  padding: "10px 12px",
  border: "1px solid rgba(154, 194, 237, 0.26)",
  borderRadius: 8,
  background: "rgba(255,255,255,0.36)",
  color: "#365575",
  fontSize: "0.86rem",
  lineHeight: 1.45,
};

const integrationCoordinateStyle = {
  marginTop: 10,
  padding: "9px 10px",
  border: "1px solid rgba(154, 194, 237, 0.22)",
  borderRadius: 8,
  background: "rgba(255,255,255,0.28)",
  color: "#486581",
  fontSize: "0.82rem",
  lineHeight: 1.45,
};

const integrationInputHintStyle = {
  marginTop: 5,
  color: "#66819d",
  fontSize: "0.75rem",
  lineHeight: 1.25,
};

function FeedbackSlot({ error = "", message = "", loadingText = "" }) {
  if (error) {
    return (
      <div style={feedbackSlotStyle}>
        <div className="panel-error">{error}</div>
      </div>
    );
  }

  if (loadingText) {
    return (
      <div style={feedbackSlotStyle}>
        <div className="panel-status">{loadingText}</div>
      </div>
    );
  }

  if (message) {
    return (
      <div style={feedbackSlotStyle}>
        <div className="panel-success">{message}</div>
      </div>
    );
  }

  return <div style={feedbackSlotStyle} />;
}

export default function HyperParamPanel({ onBattle, disabled }) {
  const [config, setConfig] = useState(() => normalizeConfig({}));
  const [originalConfig, setOriginalConfig] = useState(() => normalizeConfig({}));
  const [availableModels, setAvailableModels] = useState([]);
  const [activeConfigTab, setActiveConfigTab] = useState("io_config");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshingConfig, setRefreshingConfig] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");

  const [historySessions, setHistorySessions] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyLoadError, setHistoryLoadError] = useState("");
  const [selectedHistoryTimestamp, setSelectedHistoryTimestamp] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [historyAction, setHistoryAction] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [historyMessage, setHistoryMessage] = useState("");
  const [historyPlotRefreshKey, setHistoryPlotRefreshKey] = useState(0);

  const loadConfig = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setLoadError("");
    } else {
      setRefreshingConfig(true);
    }

    setSaveError("");
    setSaveMessage("");

    try {
      const result = await fetchTrainConfig();
      const nextConfig = normalizeConfig(result?.config ?? {});
      const nextAvailableModels = Array.isArray(result?.available_models)
        ? result.available_models
        : [];
      const nextTabs = getConfigTabs(nextConfig);
      setConfig(nextConfig);
      setOriginalConfig(cloneConfig(nextConfig));
      setAvailableModels(nextAvailableModels);
      setActiveConfigTab((prev) =>
        nextTabs.some((tab) => tab.id === prev) ? prev : nextTabs[0]?.id ?? RUN_MODE_TAB_ID
      );

      if (silent) {
        setSaveMessage("reloaded");
      }
    } catch (err) {
      setLoadError(err.message || "failed to load train config");
    } finally {
      if (!silent) {
        setLoading(false);
      } else {
        setRefreshingConfig(false);
      }
    }
  }, []);

  const loadHistorySessions = useCallback(async ({ silent = false } = {}) => {
    setHistoryLoading(true);
    setHistoryLoadError("");
    setHistoryError("");
    if (!silent) {
      setHistoryMessage("");
    }

    try {
      const sessions = await fetchHistorySessions();
      const normalized = Array.isArray(sessions) ? sessions : [];
      setHistorySessions(normalized);

      if (silent) {
        setHistoryMessage("history refreshed");
      }
    } catch (err) {
      setHistoryLoadError(err.message || "failed to load history sessions");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        await loadConfig();
      } catch {}

      if (!cancelled) {
        try {
          await loadHistorySessions();
        } catch {}
      }
    }

    boot();

    return () => {
      cancelled = true;
    };
  }, [loadConfig, loadHistorySessions]);

  const historyGroups = useMemo(
    () => groupHistorySessions(historySessions),
    [historySessions]
  );
  const selectedHistoryGroup = useMemo(
    () => historyGroups.find((group) => group.timestamp === selectedHistoryTimestamp) ?? null,
    [historyGroups, selectedHistoryTimestamp]
  );

  useEffect(() => {
    if (historyGroups.length === 0) {
      if (selectedHistoryTimestamp) setSelectedHistoryTimestamp("");
      if (selectedSessionId) setSelectedSessionId("");
      return;
    }

    const hasTimestamp = historyGroups.some(
      (group) => group.timestamp === selectedHistoryTimestamp
    );
    if (!hasTimestamp) {
      setSelectedHistoryTimestamp("");
      if (selectedSessionId) setSelectedSessionId("");
    }
  }, [historyGroups, selectedHistoryTimestamp, selectedSessionId]);

  useEffect(() => {
    if (!selectedHistoryGroup) return;

    const hasSession = selectedHistoryGroup.entries.some(
      (entry) => entry.sessionId === selectedSessionId
    );
    if (!hasSession) {
      setSelectedSessionId(selectedHistoryGroup.entries[0]?.sessionId ?? "");
    }
  }, [selectedHistoryGroup, selectedSessionId]);

  const historyBusy = Boolean(historyAction);
  const historyLoadingText = historyAction
    ? historyAction === "plot"
      ? `plotting ${selectedSessionId}...`
      : `initializing ${selectedSessionId}...`
    : historyLoading
      ? "loading history..."
      : "";
  const configBusy = disabled || saving || loading || refreshingConfig;

  function updateRunMode(nextRunMode) {
    setConfig((prev) => ({
      ...prev,
      run_mode: nextRunMode,
    }));
    setSaveError("");
  }

  function updateField(sectionName, key, rawValue) {
    const originalValue = originalConfig.sections?.[sectionName]?.[key];

    try {
      const parsed = parseEditedValue(rawValue, originalValue);
      setConfig((prev) => ({
        ...prev,
        sections: {
          ...prev.sections,
          [sectionName]: {
            ...(prev.sections[sectionName] ?? {}),
            [key]: parsed,
          },
        },
      }));
      setSaveError("");
    } catch {
      setConfig((prev) => ({
        ...prev,
        sections: {
          ...prev.sections,
          [sectionName]: {
            ...(prev.sections[sectionName] ?? {}),
            [key]: rawValue,
          },
        },
      }));
    }
  }

  function updateOptimizationIntegrationMode(nextMode) {
    const normalizedMode = normalizeIntegrationMode(nextMode);
    setConfig((prev) => {
      const section = prev.sections.optimization_config ?? {};
      const configs =
        section.loss_integration_configs && typeof section.loss_integration_configs === "object"
          ? section.loss_integration_configs
          : {};

      return {
        ...prev,
        sections: {
          ...prev.sections,
          optimization_config: {
            ...section,
            loss_numerical_integration: normalizedMode,
            loss_integration_configs: {
              ...configs,
              [normalizedMode]: {
                ...(INTEGRATION_MODE_DEFAULTS[normalizedMode] ?? {}),
                ...(configs[normalizedMode] && typeof configs[normalizedMode] === "object" ? configs[normalizedMode] : {}),
              },
            },
          },
        },
      };
    });
    setSaveError("");
  }

  function updateOptimizationIntegrationField(mode, key, rawValue) {
    const parsedValue = rawValue === "" ? "" : Number(rawValue);

    setConfig((prev) => {
      const section = prev.sections.optimization_config ?? {};
      const configs =
        section.loss_integration_configs && typeof section.loss_integration_configs === "object"
          ? section.loss_integration_configs
          : {};
      const currentModeConfig =
        configs[mode] && typeof configs[mode] === "object" ? configs[mode] : {};

      return {
        ...prev,
        sections: {
          ...prev.sections,
          optimization_config: {
            ...section,
            loss_integration_configs: {
              ...configs,
              [mode]: {
                ...(INTEGRATION_MODE_DEFAULTS[mode] ?? {}),
                ...currentModeConfig,
                [key]: Number.isNaN(parsedValue) ? rawValue : parsedValue,
              },
            },
          },
        },
      };
    });
    setSaveError("");
  }

  function renderIntegrationNumberInput(mode, key, modeConfig, coordinates) {
    const inputId = `cfg-optimization-integration-${mode}-${key}`;
    const value = modeConfig[key] ?? "";
    const label = integrationFieldLabel(key, coordinates);
    const hint = integrationFieldHint(key, coordinates);

    return (
      <div key={key} className="train-config-item">
        <label className="train-config-label" htmlFor={inputId}>
          {label}
        </label>
        <input
          id={inputId}
          className="train-config-input"
          type="number"
          value={value}
          onChange={(e) => updateOptimizationIntegrationField(mode, key, e.target.value)}
          disabled={configBusy}
        />
        {hint ? <div style={integrationInputHintStyle}>{hint}</div> : null}
      </div>
    );
  }

  function renderOptimizationIntegrationControls(section) {
    const activeMode = normalizeIntegrationMode(valueOrDefault(section, "loss_numerical_integration"));
    const lossGrid = normalizeLossIntegrationGrid(section?.loss_integration_grid);
    const coordinates = LOSS_GRID_COORDINATES[lossGrid] ?? LOSS_GRID_COORDINATES.log;
    const modeOptions = LOSS_NUMERICAL_INTEGRATION_OPTIONS.some((option) => option.value === activeMode)
      ? LOSS_NUMERICAL_INTEGRATION_OPTIONS
      : [{ value: activeMode, label: activeMode }, ...LOSS_NUMERICAL_INTEGRATION_OPTIONS];
    const modeConfig = integrationConfigFor(section, activeMode);
    const input1Bins = positiveInteger(modeConfig.loss_input1_bins, 1);
    const input2Bins = positiveInteger(modeConfig.loss_input2_bins, 1);
    const enuBins = positiveInteger(modeConfig.num_E_nu_bins, 1);
    const adaptiveDepth = positiveInteger(modeConfig.adaptive_max_depth, 1);
    const glInput1Order = positiveInteger(modeConfig.gauss_legendre_input1_order, 1);
    const glInput2Order = positiveInteger(modeConfig.gauss_legendre_input2_order, 1);
    const binSumCells = input1Bins * input2Bins * enuBins;
    const adaptiveMaxCells = Math.pow(4, adaptiveDepth);
    const gaussLegendreNodes = glInput1Order * glInput2Order * enuBins;
    const commonRangeFields = [
      "loss_input1_min",
      "loss_input1_max",
      "loss_input2_min",
      "loss_input2_max",
      "num_E_nu_bins",
    ];
    const modeFields =
      activeMode === "gauss_legendre"
        ? [...commonRangeFields, "gauss_legendre_input1_order", "gauss_legendre_input2_order"]
        : activeMode === "adaptive"
          ? [...commonRangeFields, "loss_input1_bins", "loss_input2_bins", "adaptive_max_depth", "adaptive_min_events"]
          : [...commonRangeFields, "loss_input1_bins", "loss_input2_bins"];
    const estimatorText =
      activeMode === "gauss_legendre"
        ? `estimated nodes: ${compactNumber(gaussLegendreNodes)} (${glInput1Order} x ${glInput2Order} x ${enuBins})`
        : activeMode === "adaptive"
          ? `max leaf cells: ${compactNumber(adaptiveMaxCells)}; max eval nodes: ${compactNumber(adaptiveMaxCells * enuBins)}`
          : `estimated cells: ${compactNumber(binSumCells)} (${input1Bins} x ${input2Bins} x ${enuBins})`;

    return (
      <section key="optimization-integration" style={sectionBlockStyle}>
        <h3 style={sectionTitleStyle}>Loss Integration</h3>
        <div className="train-config-item">
          <label className="train-config-label" htmlFor="train-config-loss-integration-mode">
            loss_numerical_integration
          </label>
          <select
            id="train-config-loss-integration-mode"
            className="train-config-input"
            value={activeMode}
            onChange={(e) => updateOptimizationIntegrationMode(e.target.value)}
            disabled={configBusy}
            style={runModeSelectStyle}
          >
            {modeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div style={integrationCoordinateStyle}>
          {formatCoordinateSummary("input1", coordinates.input1)}
          <br />
          {formatCoordinateSummary("input2", coordinates.input2)}
        </div>
        <div style={{ height: 12 }} />
        <div style={integrationGridStyle}>
          {modeFields.map((key) => renderIntegrationNumberInput(activeMode, key, modeConfig, coordinates))}
        </div>
        <div style={integrationEstimatorStyle}>{estimatorText}</div>
      </section>
    );
  }

  function renderSectionFields(sectionName) {
    const section = config.sections?.[sectionName] ?? {};
    const entries = Object.entries(section).filter(
      ([key]) => sectionName !== "optimization_config" || !OPTIMIZATION_INTEGRATION_KEYS.has(key)
    );

    if (entries.length === 0) {
      return (
        <section key={sectionName} style={sectionBlockStyle}>
          <h3 style={sectionTitleStyle}>{titleFromSectionName(sectionName)}</h3>
          <div className="panel-status">no fields</div>
        </section>
      );
    }

    return (
      <section key={sectionName} style={sectionBlockStyle}>
        <h3 style={sectionTitleStyle}>{titleFromSectionName(sectionName)}</h3>
        {entries.map(([key, value]) => {
          const originalValue = originalConfig.sections?.[sectionName]?.[key];
          const kind = inferInputKind(originalValue);
          const displayValue = toDisplayValue(value);
          const inputId = `cfg-${sectionName}-${key}`;

          if (sectionName === "model_config" && key === "model_name") {
            const options = availableModels.length > 0 ? availableModels : [displayValue || "HMsiren"];
            return (
              <div key={key} className="train-config-item">
                <label className="train-config-label" htmlFor={inputId}>
                  {key}
                </label>
                <select
                  id={inputId}
                  className="train-config-input"
                  value={String(displayValue)}
                  onChange={(e) => updateField(sectionName, key, e.target.value)}
                  disabled={configBusy}
                >
                  {options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            );
          }

          if (kind === "boolean") {
            return (
              <div key={key} className="train-config-item">
                <label className="train-config-label" htmlFor={inputId}>
                  {key}
                </label>
                <select
                  id={inputId}
                  className="train-config-input"
                  value={String(displayValue)}
                  onChange={(e) => updateField(sectionName, key, e.target.value)}
                  disabled={configBusy}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </div>
            );
          }

          if (kind === "json") {
            return (
              <div key={key} className="train-config-item">
                <label className="train-config-label" htmlFor={inputId}>
                  {key}
                </label>
                <textarea
                  id={inputId}
                  className="train-config-input train-config-textarea"
                  value={displayValue}
                  onChange={(e) => updateField(sectionName, key, e.target.value)}
                  disabled={configBusy}
                  rows={4}
                />
              </div>
            );
          }

          return (
            <div key={key} className="train-config-item">
              <label className="train-config-label" htmlFor={inputId}>
                {key}
              </label>
              <input
                id={inputId}
                className="train-config-input"
                type={kind === "number" ? "number" : "text"}
                value={displayValue}
                onChange={(e) => updateField(sectionName, key, e.target.value)}
                disabled={configBusy}
              />
            </div>
          );
        })}
      </section>
    );
  }

  const activeConfigContent = useMemo(() => {
    if (activeConfigTab === RUN_MODE_TAB_ID) {
      const runModeOptions = RUN_MODE_OPTIONS.includes(config.run_mode)
        ? RUN_MODE_OPTIONS
        : [config.run_mode, ...RUN_MODE_OPTIONS];
      const activeRunModeSection = RUN_MODE_SECTION_BY_MODE[config.run_mode];
      const blocks = [
        <section key="run-mode" style={sectionBlockStyle}>
          <h3 style={sectionTitleStyle}>Run Mode</h3>
          <div className="train-config-item">
            <label className="train-config-label" htmlFor="train-config-run-mode">
              run_mode
            </label>
            <select
              id="train-config-run-mode"
              className="train-config-input"
              value={config.run_mode}
              onChange={(e) => updateRunMode(e.target.value)}
              disabled={configBusy}
              style={runModeSelectStyle}
            >
              {runModeOptions.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </div>
        </section>,
      ];

      if (activeRunModeSection) {
        blocks.push(renderSectionFields(activeRunModeSection));
      } else {
        blocks.push(
          <section key="local-run-mode" style={sectionBlockStyle}>
            <h3 style={sectionTitleStyle}>Local Config</h3>
            <div className="panel-status">local has no dedicated config file</div>
          </section>
        );
      }

      return blocks;
    }

    if (activeConfigTab === "optimization_config") {
      const section = config.sections?.optimization_config ?? {};
      return [
        renderSectionFields(activeConfigTab),
        renderOptimizationIntegrationControls(section),
      ];
    }

    return [renderSectionFields(activeConfigTab)];
  }, [activeConfigTab, availableModels, config, configBusy, originalConfig]);

  async function handleRefreshConfig() {
    if (disabled || saving || loading || refreshingConfig) return;
    await loadConfig({ silent: true });
  }

  async function handleRefreshHistory() {
    if (disabled || historyBusy || historyLoading) return;
    await loadHistorySessions({ silent: true });
  }

  async function persistConfig(afterSave) {
    setSaving(true);
    setSaveError("");
    setSaveMessage("");

    try {
      const result = await saveTrainConfig(config);
      const nextConfig = normalizeConfig(result?.config ?? config);
      const nextAvailableModels = Array.isArray(result?.available_models)
        ? result.available_models
        : availableModels;
      const nextTabs = getConfigTabs(nextConfig);
      setConfig(nextConfig);
      setOriginalConfig(cloneConfig(nextConfig));
      setAvailableModels(nextAvailableModels);
      setActiveConfigTab((prev) =>
        nextTabs.some((tab) => tab.id === prev) ? prev : nextTabs[0]?.id ?? RUN_MODE_TAB_ID
      );
      await afterSave?.(nextConfig);
      return nextConfig;
    } catch (err) {
      setSaveError(err.message || "failed to save train config");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    const saved = await persistConfig();
    if (saved) {
      setSaveMessage("saved");
    }
  }

  async function handleBattle() {
    if (disabled || saving || loading || refreshingConfig) return;

    const saved = await persistConfig(async (nextConfig) => {
      setSaveMessage("saved, starting battle...");
      await onBattle?.(nextConfig);
    });

    if (!saved) {
      setSaveError((prev) => prev || "failed to save config before battle");
    }
  }

  async function handleInitialize() {
    if (disabled || historyLoading || historyAction || !selectedSessionId) {
      return;
    }

    setHistoryAction("initialize");
    setHistoryError("");
    setHistoryMessage(`initializing ${selectedSessionId}...`);

    try {
      const result = await runHistoryInitialize(selectedSessionId);
      setHistoryMessage(
        result?.message || `initialize finished: ${selectedSessionId}`
      );
    } catch (err) {
      setHistoryError(err.message || "failed to initialize from history");
    } finally {
      setHistoryAction("");
    }
  }

  async function handlePlot() {
    if (disabled || historyLoading || historyAction || !selectedSessionId) {
      return;
    }

    setHistoryAction("plot");
    setHistoryError("");
    setHistoryMessage(`plotting ${selectedSessionId}...`);

    try {
      const result = await runHistoryPlot(selectedSessionId);
      setHistoryMessage(result?.message || `plot finished: ${selectedSessionId}`);
      setHistoryPlotRefreshKey((prev) => prev + 1);
    } catch (err) {
      setHistoryError(err.message || "failed to plot history");
    } finally {
      setHistoryAction("");
    }
  }

  return (
    <div className="panel param-panel train-config-panel" style={rootStyle}>
      <section style={historyPanelStyle}>
        <div style={subHeaderStyle}>
          <h3 className="train-config-title" style={subTitleStyle}>
            History Management
          </h3>
        </div>

        <div style={historySelectWrapStyle}>
          {historyLoadError ? (
            <div className="panel-error">{historyLoadError}</div>
          ) : historySessions.length === 0 && !historyLoading ? (
            <div className="panel-status">no history sessions found</div>
          ) : (
            <>
              <div
                id="history-session-tree"
                style={historyTreeStyle}
                role="listbox"
                aria-label="History Sessions"
              >
                {historyGroups.map((group) => {
                  const selectedTimestamp = group.timestamp === selectedHistoryTimestamp;

                  return (
                    <div key={group.timestamp} style={historyGroupStyle}>
                      <button
                        type="button"
                        style={{
                          ...historyRowStyle,
                          ...(selectedTimestamp ? historyTimestampButtonActiveStyle : {}),
                        }}
                        onClick={() => {
                          if (selectedTimestamp) {
                            setSelectedHistoryTimestamp("");
                            setSelectedSessionId("");
                            setHistoryError("");
                            return;
                          }
                          setSelectedHistoryTimestamp(group.timestamp);
                          setSelectedSessionId(group.entries[0]?.sessionId ?? "");
                          setHistoryError("");
                        }}
                        disabled={disabled || historyBusy || historyLoading}
                      >
                        <span style={historyTreeIconStyle}>
                          {selectedTimestamp ? "▾" : "▸"}
                        </span>
                        <span style={historyRowTextStyle}>{group.timestamp}</span>
                      </button>

                      {selectedTimestamp
                        ? group.entries.map((entry) => {
                            const selectedEpoch = entry.sessionId === selectedSessionId;
                            return (
                              <button
                                key={entry.sessionId}
                                type="button"
                                style={{
                                  ...historyEpochButtonStyle,
                                  ...(selectedEpoch ? historyEpochButtonActiveStyle : {}),
                                }}
                                onClick={() => {
                                  setSelectedSessionId(entry.sessionId);
                                  setHistoryError("");
                                }}
                                disabled={disabled || historyBusy || historyLoading}
                              >
                                <span style={historyTreeIconStyle}>└</span>
                                <span style={historyRowTextStyle}>{entry.epoch || "root"}</span>
                              </button>
                            );
                          })
                        : null}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <FeedbackSlot
          error={historyError}
          message={historyMessage}
          loadingText={historyLoadingText}
        />

        <div style={actionRowStyle}>
          <button
            className="train-config-btn"
            onClick={handleRefreshHistory}
            disabled={disabled || historyBusy || historyLoading}
          >
            {historyLoading ? "loading..." : "refresh history"}
          </button>

          <button
            className="train-config-btn"
            onClick={handleInitialize}
            disabled={
              disabled || historyLoading || historyBusy || !selectedSessionId
            }
          >
            {historyAction === "initialize" ? "initializing..." : "initialize"}
          </button>

          <button
            className="train-config-btn"
            onClick={handlePlot}
            disabled={
              disabled || historyLoading || historyBusy || !selectedSessionId
            }
          >
            {historyAction === "plot" ? "plotting..." : "plot"}
          </button>
        </div>

        <PlotImageBrowser
          title="History Plots"
          mode="session"
          sessionId={selectedSessionId}
          refreshKey={historyPlotRefreshKey}
          overlayClassName="plot-browser-overlay-chat"
        />
      </section>

      <section style={subPanelStyle}>
        <div style={subHeaderStyle}>
          <h2 className="train-config-title" style={subTitleStyle}>
            Training Plan
          </h2>
        </div>

        {loading && <div className="panel-status">loading...</div>}
        {loadError && <div className="panel-error">{loadError}</div>}

        {!loading && !loadError && (
          <>
            <div
              style={{
                ...tabRowStyle,
                gridTemplateColumns: `repeat(${getConfigTabs(config).length}, minmax(0, 1fr))`,
              }}
            >
              {getConfigTabs(config).map((tab, index) => {
                const active = activeConfigTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    className="train-config-btn"
                    onClick={() => setActiveConfigTab(tab.id)}
                    disabled={configBusy}
                    style={{
                      borderRadius: 0,
                      marginLeft: index === 0 ? 0 : -1,
                      background: active ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.05)",
                      borderColor: active ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.15)",
                      position: active ? "relative" : "static",
                      zIndex: active ? 1 : 0,
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="train-config-scroll" style={configScrollStyle}>
              <div className="train-config-list">{activeConfigContent}</div>
            </div>

            <FeedbackSlot
              error={saveError}
              message={saveMessage}
              loadingText=""
            />

            <div style={actionRowStyle}>
              <button
                className="train-config-btn"
                onClick={handleRefreshConfig}
                disabled={configBusy}
              >
                {refreshingConfig ? "reloading..." : "refresh"}
              </button>

              <button
                className="train-config-btn"
                onClick={handleSave}
                disabled={configBusy}
              >
                {saving ? "saving..." : "save"}
              </button>

              <button
                className="train-config-btn train-config-btn-primary"
                onClick={handleBattle}
                disabled={configBusy}
              >
                start training
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
