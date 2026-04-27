import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { APP_CONFIG } from "../../../config";
import PlotImageBrowser from "./PlotImageBrowser";

export default function BattlePanel({
  lossData,
  sourcePath,
  onForceExit,
  onSaveHistoryAndPlot,
  exiting,
  historyAction,
  historyMessage,
  historyError,
  historyStatusKind,
  lastPlottedSessionId,
  plotRefreshKey,
}) {
  const recentData = lossData.slice(
    -APP_CONFIG.battleCharts.recentWindowPoints
  );
  const historyBusy = Boolean(historyAction);
  const historyStatusClass = historyError
    ? "battle-tool-status battle-tool-status-error"
    : historyStatusKind === "success"
      ? "battle-tool-status battle-tool-status-success"
      : "battle-tool-status";

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
            onClick={onSaveHistoryAndPlot}
            disabled={exiting || historyBusy}
          >
            {historyBusy ? "Saving/Plotting..." : "Save History & Plot"}
          </button>
          <button
            className="battle-exit-btn"
            onClick={onForceExit}
            disabled={exiting || historyBusy}
          >
            {exiting ? "Exiting..." : "Force Exit"}
          </button>
        </div>
      </div>

      {(historyMessage || historyError) && (
        <div className={historyStatusClass}>
          {historyError || historyMessage}
        </div>
      )}

      <PlotImageBrowser
        title="Latest Battle Images"
        mode="latest"
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
