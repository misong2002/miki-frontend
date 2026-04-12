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
    const text = [
      result?.session_id,
      result?.history_session,
      result?.stdout_preview,
      result?.message,
    ]
      .filter(Boolean)
      .join("\n");
    const matches = [...text.matchAll(/\b(\d{8}_\d{6})\b/g)];
    return matches.at(-1)?.[1] ?? "";
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
          <div className="battle-title">Magic Power Monitoring</div>
          <div className="battle-subtitle">source: {sourcePath}</div>
        </div>

        <div className="battle-header-actions">
          <button
            className="battle-exit-btn"
            onClick={handleSaveHistoryAndPlot}
            disabled={exiting || Boolean(historyAction)}
          >
            {historyAction ? "保存/绘图中..." : "保存历史并绘图"}
          </button>
          <button
            className="battle-exit-btn"
            onClick={onForceExit}
            disabled={exiting}
          >
            {exiting ? "撤出中..." : "强行撤出战斗"}
          </button>
        </div>
      </div>

      {(historyMessage || historyError) && (
        <div className={historyError ? "battle-tool-status battle-tool-status-error" : "battle-tool-status"}>
          {historyError || historyMessage}
        </div>
      )}

      <PlotImageBrowser
        title="最新战斗图片"
        mode={lastPlottedSessionId ? "session" : "latest"}
        sessionId={lastPlottedSessionId}
        refreshKey={plotRefreshKey}
      />

      <div className="battle-chart-block">
        <div className="battle-chart-title">魔力波动记录（loss vs epoch）</div>
        <div className="battle-chart-box">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={lossData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,140,180,0.18)" />
              <XAxis dataKey="epoch" type="number" domain={["dataMin", "dataMax"]} />
              <YAxis
              scale='log' 
              domain={["auto", "auto"]} 
              tickFormatter={(v) => v.toExponential(1)}
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
        <div className="battle-chart-title">最近魔力波动（loss vs epoch）</div>
        <div className="battle-chart-box">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={recentData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,140,180,0.18)" />
              <XAxis
                  dataKey="epoch"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                />
              <YAxis domain={["auto", "auto"]} />
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
