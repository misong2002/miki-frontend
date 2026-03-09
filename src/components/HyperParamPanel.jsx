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
        模型构筑
        <input
          type="text"
          value={params.modelName}
          onChange={(e) => updateField("modelName", e.target.value)}
          disabled={disabled}
        />
      </label>

      <label>
        数据集
        <input
          type="text"
          value={params.dataset}
          onChange={(e) => updateField("dataset", e.target.value)}
          disabled={disabled}
        />
      </label>

      <label>
        束流
        <input
          type="text"
          value={params.flux}
          onChange={(e) => updateField("flux", e.target.value)}
          disabled={disabled}
        />
      </label>

      <label>
        输出模型参数
        <input
          type="text"
          value={params.output}
          onChange={(e) => updateField("output", e.target.value)}
          disabled={disabled}
        />
      </label>

      <label>
        轮数
        <input
          type="number"
          value={params.rounds}
          onChange={(e) => updateField("rounds", Number(e.target.value))}
          disabled={disabled}
        />
      </label>

      <label>
        学习率
        <input
          type="number"
          step="0.0001"
          value={params.lr}
          onChange={(e) => updateField("lr", Number(e.target.value))}
          disabled={disabled}
        />
      </label>

      <label>
        层级大小
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