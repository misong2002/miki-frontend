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

const RUN_MODE_OPTIONS = ["local", "cluster", "debug"];
const SECTION_ORDER = [
  "io_config",
  "model_config",
  "optimization_config",
  "cluster_config",
  "debug_config",
];
const CONFIG_TABS = [
  { id: "io_config", label: "io" },
  { id: "model_config", label: "model" },
  { id: "optimization_config", label: "optimzt" },
  { id: "run mode", label: "run mode" },
];
const SECTION_TITLES = {
  io_config: "IO Config",
  model_config: "Model Config",
  optimization_config: "Optimization Config",
  cluster_config: "Cluster Config",
  debug_config: "Debug Config",
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

function normalizeConfig(config) {
  const sections = config?.sections && typeof config.sections === "object" ? config.sections : {};
  const normalizedSections = {};

  for (const sectionName of SECTION_ORDER) {
    normalizedSections[sectionName] =
      sections[sectionName] && typeof sections[sectionName] === "object"
        ? sections[sectionName]
        : {};
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
  flex: 1,
  display: "flex",
  flexDirection: "column",
};

const historySelectStyle = {
  width: "100%",
  flex: 1,
  minHeight: 0,
  boxSizing: "border-box",
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
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
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
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [historyAction, setHistoryAction] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [historyMessage, setHistoryMessage] = useState("");

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
      setConfig(nextConfig);
      setOriginalConfig(cloneConfig(nextConfig));
      setAvailableModels(nextAvailableModels);

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

      setSelectedSessionId((prev) => {
        if (prev && normalized.some((item) => toSessionId(item) === prev)) {
          return prev;
        }
        return normalized.length > 0 ? toSessionId(normalized[0]) : "";
      });

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
            ...prev.sections[sectionName],
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
            ...prev.sections[sectionName],
            [key]: rawValue,
          },
        },
      }));
    }
  }

  function renderSectionFields(sectionName) {
    const section = config.sections?.[sectionName] ?? {};
    const entries = Object.entries(section);

    if (entries.length === 0) {
      return (
        <section key={sectionName} style={sectionBlockStyle}>
          <h3 style={sectionTitleStyle}>{SECTION_TITLES[sectionName] ?? sectionName}</h3>
          <div className="panel-status">no fields</div>
        </section>
      );
    }

    return (
      <section key={sectionName} style={sectionBlockStyle}>
        <h3 style={sectionTitleStyle}>{SECTION_TITLES[sectionName] ?? sectionName}</h3>
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
    if (activeConfigTab === "run mode") {
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
              {RUN_MODE_OPTIONS.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </div>
        </section>,
      ];

      if (config.run_mode === "cluster") {
        blocks.push(renderSectionFields("cluster_config"));
      }
      if (config.run_mode === "debug") {
        blocks.push(renderSectionFields("debug_config"));
      }
      if (config.run_mode === "local") {
        blocks.push(
          <section key="local-info" style={sectionBlockStyle}>
            <h3 style={sectionTitleStyle}>Local Mode</h3>
            <div className="panel-status">no extra fields for local mode</div>
          </section>
        );
      }

      return blocks;
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
      setConfig(nextConfig);
      setOriginalConfig(cloneConfig(nextConfig));
      setAvailableModels(nextAvailableModels);
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
    } catch (err) {
      setHistoryError(err.message || "failed to plot history");
    } finally {
      setHistoryAction("");
    }
  }

  return (
    <div className="panel param-panel train-config-panel" style={rootStyle}>
      <section style={subPanelStyle}>
        <div style={subHeaderStyle}>
          <h3 className="train-config-title" style={subTitleStyle}>
            历史工具
          </h3>
          <div className="train-config-subtitle" style={subSubtitleStyle}>
            select a session, then initialize or plot
          </div>
        </div>

        <label className="train-config-label" htmlFor="history-session-select">
          历史会话
        </label>

        <div style={historySelectWrapStyle}>
          {historyLoadError ? (
            <div className="panel-error">{historyLoadError}</div>
          ) : historySessions.length === 0 && !historyLoading ? (
            <div className="panel-status">no history sessions found</div>
          ) : (
            <select
              id="history-session-select"
              className="train-config-input"
              size={6}
              value={selectedSessionId}
              onChange={(e) => {
                setSelectedSessionId(e.target.value);
                setHistoryError("");
              }}
              disabled={disabled || historyBusy || historyLoading}
              style={historySelectStyle}
            >
              {historySessions.map((item) => {
                const sessionId = toSessionId(item);
                const label = toSessionLabel(item);

                return (
                  <option key={sessionId} value={sessionId}>
                    {label}
                  </option>
                );
              })}
            </select>
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
      </section>

      <section style={subPanelStyle}>
        <div style={subHeaderStyle}>
          <h2 className="train-config-title" style={subTitleStyle}>
            战斗计划
          </h2>
          <div className="train-config-subtitle" style={subSubtitleStyle}>
            edit and save directly
          </div>
        </div>

        {loading && <div className="panel-status">loading...</div>}
        {loadError && <div className="panel-error">{loadError}</div>}

        {!loading && !loadError && (
          <>
            <div style={tabRowStyle}>
              {CONFIG_TABS.map((tab, index) => {
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
                start battle
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
