import { useEffect, useMemo, useState } from "react";
import {
  fetchTrainConfig,
  saveTrainConfig,
} from "../services/trainConfigService";

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

export default function HyperParamPanel({ onBattle, disabled }) {
  const [config, setConfig] = useState({});
  const [originalConfig, setOriginalConfig] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      setLoading(true);
      setLoadError("");
      setSaveError("");
      setSaveMessage("");

      try {
        const result = await fetchTrainConfig();
        if (cancelled) return;

        const nextConfig = result?.config ?? {};
        setConfig(nextConfig);
        setOriginalConfig(nextConfig);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err.message || "failed to load train config");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  const entries = useMemo(() => Object.entries(config), [config]);

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
    if (disabled || saving || loading) return;

    setSaveError("");
    setSaveMessage("");

    try {
      const result = await saveTrainConfig(config);
      const nextConfig = result?.config ?? config;

      setConfig(nextConfig);
      setOriginalConfig(nextConfig);

      await onBattle?.(nextConfig);
    } catch (err) {
      setSaveError(err.message || "failed to save config before battle");
    }
  }

  return (
    <div className="panel param-panel train-config-panel">
      <div className="train-config-header">
        <h2 className="train-config-title">战斗计划</h2>
        <div className="train-config-subtitle">edit and save directly</div>
      </div>

      {loading && <div className="panel-status">loading...</div>}
      {loadError && <div className="panel-error">{loadError}</div>}

      {!loading && !loadError && (
        <>
          <div className="train-config-scroll">
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
                        disabled={disabled || saving}
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
                        disabled={disabled || saving}
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
                      disabled={disabled || saving}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {saveError && <div className="panel-error">{saveError}</div>}
          {saveMessage && <div className="panel-success">{saveMessage}</div>}

          <div className="train-config-actions">
            <button
              className="train-config-btn"
              onClick={handleSave}
              disabled={disabled || saving || loading}
            >
              {saving ? "saving..." : "save"}
            </button>

            <button
              className="train-config-btn train-config-btn-primary"
              onClick={handleBattle}
              disabled={disabled || saving || loading}
            >
              start battle
            </button>
          </div>
        </>
      )}
    </div>
  );
}