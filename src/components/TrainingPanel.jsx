export default function TrainingPanel({ training }) {
  return (
    <div className="panel training-panel">
      <h2>训练面板</h2>

      <div className="metric-row">
        <span>Status:</span>
        <span>{training.status}</span>
      </div>

      <div className="metric-row">
        <span>Epoch:</span>
        <span>{training.epoch}</span>
      </div>

      <div className="metric-row">
        <span>Step:</span>
        <span>{training.step}</span>
      </div>

      <div className="metric-row">
        <span>Loss:</span>
        <span>{training.loss ?? "--"}</span>
      </div>

      <div className="box-title">日志</div>
      <div className="display-box grow">
        {training.logs.length ? training.logs.join("\n") : "（暂无日志）"}
      </div>
    </div>
  );
}