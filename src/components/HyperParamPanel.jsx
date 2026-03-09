export default function HyperParamPanel({
  params,
  setParams,
  onBattle,
  disabled,
}) {
  function updateField(key, value) {
    setParams((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  return (
    <div className="panel param-panel">
      <h2>战斗计划</h2>

      <label>
        learning rate
        <input
          type="number"
          step="0.0001"
          value={params.learningRate}
          onChange={(e) => updateField("learningRate", Number(e.target.value))}
          disabled={disabled}
        />
      </label>

      <label>
        batch size
        <input
          type="number"
          value={params.batchSize}
          onChange={(e) => updateField("batchSize", Number(e.target.value))}
          disabled={disabled}
        />
      </label>

      <label>
        epochs
        <input
          type="number"
          value={params.epochs}
          onChange={(e) => updateField("epochs", Number(e.target.value))}
          disabled={disabled}
        />
      </label>

      <label>
        hidden dim
        <input
          type="number"
          value={params.hiddenDim}
          onChange={(e) => updateField("hiddenDim", Number(e.target.value))}
          disabled={disabled}
        />
      </label>

      <button onClick={onBattle} disabled={disabled}>
        开启战斗
      </button>
    </div>
  );
}