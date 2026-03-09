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
      <h2>战斗参数</h2>

      <label>
        model name
        <input
          type="text"
          value={params.modelName}
          onChange={(e) => updateField("modelName", e.target.value)}
          disabled={disabled}
        />
      </label>

      <label>
        dataset
        <input
          type="text"
          value={params.dataset}
          onChange={(e) => updateField("dataset", e.target.value)}
          disabled={disabled}
        />
      </label>

      <label>
        flux
        <input
          type="text"
          value={params.flux}
          onChange={(e) => updateField("flux", e.target.value)}
          disabled={disabled}
        />
      </label>

      <label>
        output
        <input
          type="text"
          value={params.output}
          onChange={(e) => updateField("output", e.target.value)}
          disabled={disabled}
        />
      </label>

      <label>
        rounds
        <input
          type="number"
          value={params.rounds}
          onChange={(e) => updateField("rounds", Number(e.target.value))}
          disabled={disabled}
        />
      </label>

      <label>
        lr
        <input
          type="number"
          step="0.0001"
          value={params.lr}
          onChange={(e) => updateField("lr", Number(e.target.value))}
          disabled={disabled}
        />
      </label>

      <label>
        layer sizes
        <input
          type="text"
          value={params.layerSizes}
          onChange={(e) => updateField("layerSizes", e.target.value)}
          disabled={disabled}
          placeholder="2,128,128,3"
        />
      </label>

      <button onClick={onBattle} disabled={disabled}>
        开启战斗
      </button>
    </div>
  );
}