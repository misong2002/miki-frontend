import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export default function BattlePanel({ lossData, sourcePath, onForceExit, exiting }) {
  const recentData = lossData.slice(-100);

  return (
    <div className="battle-shell">
      <div className="battle-header">
        <div>
          <div className="battle-title">Loss Monitoring</div>
          <div className="battle-subtitle">source: {sourcePath}</div>
        </div>

        <button
          className="battle-exit-btn"
          onClick={onForceExit}
          disabled={exiting}
        >
          {exiting ? "撤出中..." : "强行撤出战斗"}
        </button>
      </div>

      <div className="battle-chart-block">
        <div className="battle-chart-title">整体 Loss</div>
        <div className="battle-chart-box">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={lossData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,140,180,0.18)" />
              <XAxis dataKey="epoch" />
              <YAxis domain={["auto", "auto"]} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="loss"
                stroke="#5b84c9"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="battle-chart-block">
        <div className="battle-chart-title">最近 100 个 Epoch</div>
        <div className="battle-chart-box">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={recentData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,140,180,0.18)" />
              <XAxis dataKey="epoch" />
              <YAxis domain={["auto", "auto"]} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="loss"
                stroke="#d1b56f"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}