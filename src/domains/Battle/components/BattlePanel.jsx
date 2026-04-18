import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useState } from "react";
import { APP_CONFIG } from "../../../config";
import { saveTrainingHistory } from "../services/historyService";
import { runHistoryPlot } from "../services/historyToolService";
import PlotImageBrowser from "./PlotImageBrowser";

export default function BattlePanel({ lossData, sourcePath, onForceExit, exiting }) {
  const [historyAction, setHistoryAction] = useState("");
  const [historyMessage, setHistoryMessage] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [lastPlottedSessionId, setLastPlottedSessionId] = useState("");
  const [plotRefreshKey, setPlotRefreshKey] = useState(0);
  const recentData = lossData.slice(
    -APP_CONFIG.battleCharts.recentWindowPoints
  );

  function extractHistorySessionId(result) {
    const directSession = String(
      result?.history_session || result?.session_id || ""
    ).trim();
    if (/^\d{8}_\d{6}\/(?:epoch\d+\(model on epoch \d+\)(?:_\d+)?|\d+)$/.test(directSession)) {
      return directSession;
    }

    const text = [result?.stdout_preview, result?.message]
      .filter(Boolean)
      .join("\n");
    const leafMatches = [
      ...text.matchAll(
        /(\d{8}_\d{6}\/(?:epoch\d+\(model on epoch \d+\)(?:_\d+)?|\d+))/g
      ),
    ];
    if (leafMatches.length > 0) {
      return leafMatches.at(-1)?.[1] ?? "";
    }

    if (/^\d{8}_\d{6}$/.test(directSession)) {
      return directSession;
    }

    const timestampMatches = [...text.matchAll(/\b(\d{8}_\d{6})\b/g)];
    return timestampMatches.at(-1)?.[1] ?? "";
  }

  async function handleSaveHistoryAndPlot() {
    if (historyAction || exiting) return;

    setHistoryAction("save-plot");
    setHistoryError("");
    setHistoryMessage("saving history...");

    try {
      const saveResult = await saveTrainingHistory("config/train_config.json");
      const sessionId = extractHistorySessionId(saveResult);

      if (!sessionId) {
        throw new Error("history saved but session_id was not returned");
      }

      if (saveResult?.should_plot === false) {
        setLastPlottedSessionId(sessionId);
        setPlotRefreshKey((prev) => prev + 1);
        setHistoryMessage(
          `history saved: ${sessionId}; skipped plot because model epoch did not change`
        );
        return;
      }

      setHistoryMessage(`plotting ${sessionId}...`);
      const plotResult = await runHistoryPlot(sessionId);
      setLastPlottedSessionId(sessionId);
      setPlotRefreshKey((prev) => prev + 1);
      setHistoryMessage(plotResult?.message || `plot finished: ${sessionId}`);
    } catch (err) {
      setHistoryError(err.message || "failed to save history and plot");
      setHistoryMessage("");
    } finally {
      setHistoryAction("");
    }
  }

  //console.log("[Battle Panel]:drawing with recent data:" ,recentData)
  return (
    <div className="battle-shell">
      <div className="battle-header">
        <div>
          <div className="battle-title">Loss Monitoring</div>
          <div className="battle-subtitle">source: {sourcePath}</div>
        </div>

        <div className="battle-header-actions">
          <button
            className="battle-exit-btn"
            onClick={handleSaveHistoryAndPlot}
            disabled={exiting || Boolean(historyAction)}
          >
            {historyAction ? "Saving/Plotting..." : "Save History & Plot"}
          </button>
          <button
            className="battle-exit-btn"
            onClick={onForceExit}
            disabled={exiting}
          >
            {exiting ? "Exiting..." : "Force Exit"}
          </button>
        </div>
      </div>

      {(historyMessage || historyError) && (
        <div className={historyError ? "battle-tool-status battle-tool-status-error" : "battle-tool-status"}>
          {historyError || historyMessage}
        </div>
      )}

      <PlotImageBrowser
        title="Latest Battle Images"
        mode={lastPlottedSessionId ? "session" : "latest"}
        sessionId={lastPlottedSessionId}
        refreshKey={plotRefreshKey}
      />

      <div className="battle-chart-block">
        <div className="battle-chart-title">Loss History（loss vs epoch）</div>
        <div className="battle-chart-box">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={lossData} margin={{ left: 12, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,140,180,0.18)" />
              <XAxis dataKey="epoch" type="number" domain={["dataMin", "dataMax"]} />
              <YAxis
                width={72}
                scale="log"
                domain={["auto", "auto"]}
                tickFormatter={(v) => v.toExponential(3)}
              />
              <Tooltip  isAnimationActive={false}/>
              <Line
                type="monotone"
                dataKey="loss"
                stroke="#5b84c9"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="battle-chart-block">
        <div className="battle-chart-title">Recent loss（loss vs epoch）</div>
        <div className="battle-chart-box">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={recentData} margin={{ left: 12, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,140,180,0.18)" />
              <XAxis
                  dataKey="epoch"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                />
              <YAxis
                width={72}
                domain={["auto", "auto"]}
                tickFormatter={(v) => v.toExponential(3)}
              />
              <Tooltip  isAnimationActive={false}/>
              <Line
                type="monotone"
                dataKey="loss"
                stroke="#d1b56f"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
