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
  const recentData = lossData.slice(-200);
  //console.log("[Battle Panel]:drawing with recent data:" ,recentData)
  return (
    <div className="battle-shell">
      <div className="battle-header">
        <div>
          <div className="battle-title">Magic Power Monitoring</div>
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
        <div className="battle-chart-title">魔力波动记录（loss vs epoch）</div>
        <div className="battle-chart-box">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={lossData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,140,180,0.18)" />
              <XAxis dataKey="epoch" />
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
            <LineChart data={recentData.slice(-200)}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,140,180,0.18)" />
              <XAxis dataKey="epoch" />
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