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
};

const feedbackSlotStyle = {
  minHeight: 22,
  marginTop: 8,
  flex: "0 0 auto",
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
  const [config, setConfig] = useState({});
  const [originalConfig, setOriginalConfig] = useState({});
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
      const nextConfig = result?.config ?? {};
      setConfig(nextConfig);
      setOriginalConfig(nextConfig);

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

  const entries = useMemo(() => Object.entries(config), [config]);

  const historyBusy = Boolean(historyAction);
  const configBusy = disabled || saving || loading || refreshingConfig;

  function updateField(key, rawValue) {
    const originalValue = originalConfig[key];

    try {
      const parsed = parseEditedValue(rawValue, originalValue);
      setConfig((prev) => ({
        ...prev,
        [key]: parsed,
      }));
      setSaveError("");
    } catch {
      setConfig((prev) => ({
        ...prev,
        [key]: rawValue,
      }));
    }
  }

  async function handleRefreshConfig() {
    if (disabled || saving || loading || refreshingConfig) return;
    await loadConfig({ silent: true });
  }

  async function handleRefreshHistory() {
    if (disabled || historyBusy || historyLoading) return;
    await loadHistorySessions({ silent: true });
  }

  async function handleSave() {
    setSaving(true);
    setSaveError("");
    setSaveMessage("");

    try {
      const result = await saveTrainConfig(config);
      const nextConfig = result?.config ?? config;
      setConfig(nextConfig);
      setOriginalConfig(nextConfig);
      setSaveMessage("saved");
    } catch (err) {
      setSaveError(err.message || "failed to save train config");
    } finally {
      setSaving(false);
    }
  }

  async function handleBattle() {
    if (disabled || saving || loading || refreshingConfig) return;

    setSaveError("");
    setSaveMessage("");

    try {
      const result = await saveTrainConfig(config);
      const nextConfig = result?.config ?? config;

      setConfig(nextConfig);
      setOriginalConfig(nextConfig);
      setSaveMessage("saved, starting battle...");

      await onBattle?.(nextConfig);
    } catch (err) {
      setSaveError(err.message || "failed to save config before battle");
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
          loadingText={historyLoading ? "loading history..." : ""}
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
            <div className="train-config-scroll" style={configScrollStyle}>
              <div className="train-config-list">
                {entries.map(([key, value]) => {
                  const originalValue = originalConfig[key];
                  const kind = inferInputKind(originalValue);
                  const displayValue = toDisplayValue(value);

                  if (kind === "boolean") {
                    return (
                      <div key={key} className="train-config-item">
                        <label className="train-config-label" htmlFor={`cfg-${key}`}>
                          {key}
                        </label>
                        <select
                          id={`cfg-${key}`}
                          className="train-config-input"
                          value={String(displayValue)}
                          onChange={(e) => updateField(key, e.target.value)}
                          disabled={disabled || saving || refreshingConfig}
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
                        <label className="train-config-label" htmlFor={`cfg-${key}`}>
                          {key}
                        </label>
                        <textarea
                          id={`cfg-${key}`}
                          className="train-config-input train-config-textarea"
                          value={displayValue}
                          onChange={(e) => updateField(key, e.target.value)}
                          disabled={disabled || saving || refreshingConfig}
                          rows={4}
                        />
                      </div>
                    );
                  }

                  return (
                    <div key={key} className="train-config-item">
                      <label className="train-config-label" htmlFor={`cfg-${key}`}>
                        {key}
                      </label>
                      <input
                        id={`cfg-${key}`}
                        className="train-config-input"
                        type={kind === "number" ? "number" : "text"}
                        value={displayValue}
                        onChange={(e) => updateField(key, e.target.value)}
                        disabled={disabled || saving || refreshingConfig}
                      />
                    </div>
                  );
                })}
              </div>
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
                disabled={disabled || saving || loading || refreshingConfig}
              >
                {saving ? "saving..." : "save"}
              </button>

              <button
                className="train-config-btn train-config-btn-primary"
                onClick={handleBattle}
                disabled={disabled || saving || loading || refreshingConfig}
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