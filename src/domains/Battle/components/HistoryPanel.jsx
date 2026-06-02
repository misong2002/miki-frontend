import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchHistorySessions,
  runHistoryInitialize,
  runHistoryPlot,
} from "../services/historyToolService";
import PlotImageBrowser from "./PlotImageBrowser";

// ── helpers ────────────────────────────────────────────────────────────────
function FeedbackSlot({ error = "", message = "", loadingText = "" }) {
  if (error) return <div className="feedback-slot"><div className="panel-error">{error}</div></div>;
  if (loadingText) return <div className="feedback-slot"><div className="panel-status">{loadingText}</div></div>;
  if (message) return <div className="feedback-slot"><div className="panel-success">{message}</div></div>;
  return <div className="feedback-slot" />;
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
  if (typeof item === "string") return item.replace(/^history\//, "");
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
    return { lossEpoch: Number(text), modelEpoch: 0, suffix: 0 };
  }
  return { lossEpoch: -1, modelEpoch: -1, suffix: -1 };
}

function groupHistorySessions(sessions) {
  const groupsByTimestamp = new Map();
  for (const item of sessions) {
    const sessionId = toSessionId(item);
    const timestamp = historyTimestampOf(item);
    if (!sessionId || !timestamp) continue;
    if (!groupsByTimestamp.has(timestamp)) {
      groupsByTimestamp.set(timestamp, { timestamp, entries: [] });
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

// ── component ──────────────────────────────────────────────────────────────
export default function HistoryPanel({ disabled = false }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedTimestamp, setSelectedTimestamp] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [plotRefreshKey, setPlotRefreshKey] = useState(0);

  // ── load ──────────────────────────────────────────────────────────────
  const loadSessions = useCallback(async ({ silent = false } = {}) => {
    setLoading(true);
    setLoadError("");
    setError("");
    if (!silent) setMessage("");
    try {
      const result = await fetchHistorySessions();
      setSessions(Array.isArray(result) ? result : []);
      if (silent) setMessage("history refreshed");
    } catch (err) {
      setLoadError(err.message || "failed to load history sessions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // ── groups ────────────────────────────────────────────────────────────
  const groups = useMemo(() => groupHistorySessions(sessions), [sessions]);
  const selectedGroup = useMemo(
    () => groups.find((g) => g.timestamp === selectedTimestamp) ?? null,
    [groups, selectedTimestamp]
  );

  useEffect(() => {
    if (groups.length === 0) {
      if (selectedTimestamp) setSelectedTimestamp("");
      if (selectedSessionId) setSelectedSessionId("");
      return;
    }
    if (!groups.some((g) => g.timestamp === selectedTimestamp)) {
      setSelectedTimestamp("");
      if (selectedSessionId) setSelectedSessionId("");
    }
  }, [groups, selectedTimestamp, selectedSessionId]);

  useEffect(() => {
    if (!selectedGroup) return;
    if (!selectedGroup.entries.some((e) => e.sessionId === selectedSessionId)) {
      setSelectedSessionId(selectedGroup.entries[0]?.sessionId ?? "");
    }
  }, [selectedGroup, selectedSessionId]);

  // ── actions ───────────────────────────────────────────────────────────
  const busy = Boolean(action);
  const loadingText = action
    ? action === "plot"
      ? `plotting ${selectedSessionId}...`
      : `initializing ${selectedSessionId}...`
    : loading
      ? "loading history..."
      : "";

  async function handleRefresh() {
    if (disabled || busy || loading) return;
    await loadSessions({ silent: true });
  }

  async function handleInitialize() {
    if (disabled || loading || busy || !selectedSessionId) return;
    setAction("initialize");
    setError(""); setMessage(`initializing ${selectedSessionId}...`);
    try {
      const result = await runHistoryInitialize(selectedSessionId);
      setMessage(result?.message || `initialize finished: ${selectedSessionId}`);
    } catch (err) {
      setError(err.message || "failed to initialize from history");
    } finally { setAction(""); }
  }

  async function handlePlot() {
    if (disabled || loading || busy || !selectedSessionId) return;
    setAction("plot");
    setError(""); setMessage(`plotting ${selectedSessionId}...`);
    try {
      const result = await runHistoryPlot(selectedSessionId);
      setMessage(result?.message || `plot finished: ${selectedSessionId}`);
      setPlotRefreshKey((prev) => prev + 1);
    } catch (err) {
      setError(err.message || "failed to plot history");
    } finally { setAction(""); }
  }

  // ── render ────────────────────────────────────────────────────────────
  return (
    <div className="panel param-panel train-config-panel history-panel">
      <div className="train-config-header">
        <h3 className="train-config-title">History Management</h3>
      </div>

      <div className="history-panel-body">
        <div className="history-tree-col">
          {loadError ? (
            <div className="panel-error">{loadError}</div>
          ) : sessions.length === 0 && !loading ? (
            <div className="panel-status">no history sessions found</div>
          ) : (
            <div
              id="history-session-tree"
              className="history-tree"
              role="listbox"
              aria-label="History Sessions"
            >
              {groups.map((group) => {
                const selTs = group.timestamp === selectedTimestamp;
                return (
                  <div key={group.timestamp}>
                    <button
                      type="button"
                      className={"history-tree-row" + (selTs ? " active" : "")}
                      onClick={() => {
                        if (selTs) {
                          setSelectedTimestamp("");
                          setSelectedSessionId("");
                          setError("");
                          return;
                        }
                        setSelectedTimestamp(group.timestamp);
                        setSelectedSessionId(group.entries[0]?.sessionId ?? "");
                        setError("");
                      }}
                      disabled={disabled || busy || loading}
                    >
                      <span className="history-tree-icon">{selTs ? "▾" : "▸"}</span>
                      <span className="history-tree-row-text">{group.timestamp}</span>
                    </button>
                    {selTs && group.entries.map((entry) => {
                      const selEp = entry.sessionId === selectedSessionId;
                      return (
                        <button
                          key={entry.sessionId}
                          type="button"
                          className={"history-tree-row child" + (selEp ? " active" : "")}
                          onClick={() => { setSelectedSessionId(entry.sessionId); setError(""); }}
                          disabled={disabled || busy || loading}
                        >
                          <span className="history-tree-icon">└</span>
                          <span className="history-tree-row-text">{entry.epoch || "root"}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="history-actions-col">
          <button className="train-config-btn" onClick={handleRefresh}
            disabled={disabled || busy || loading}>
            {loading ? "loading..." : "refresh history"}
          </button>
          <button className="train-config-btn" onClick={handleInitialize}
            disabled={disabled || loading || busy || !selectedSessionId}>
            {action === "initialize" ? "initializing..." : "initialize"}
          </button>
          <button className="train-config-btn" onClick={handlePlot}
            disabled={disabled || loading || busy || !selectedSessionId}>
            {action === "plot" ? "plotting..." : "plot"}
          </button>
          <FeedbackSlot error={error} message={message} loadingText={loadingText} />
        </div>
      </div>

      <PlotImageBrowser
        title="History Plots"
        mode="session"
        sessionId={selectedSessionId}
        refreshKey={plotRefreshKey}
      />
    </div>
  );
}
