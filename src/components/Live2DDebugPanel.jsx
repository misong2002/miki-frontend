import { useState } from "react";
import { live2dController } from "../live2d/live2dController";

export default function Live2DDebugPanel() {
  const [expressionId, setExpressionId] = useState("10");
  const [motionId, setMotionId] = useState("000");

  return (
    <div className="panel live2d-debug-panel">
      <h2>Live2D 调试面板</h2>

      <label>
        Expression ID
        <input
          type="text"
          value={expressionId}
          onChange={(e) => setExpressionId(e.target.value)}
          placeholder="例如 10 / 40 / 50"
        />
      </label>

      <div className="debug-actions">
        <button onClick={() => live2dController.setExpressionById(expressionId)}>
          设置表情
        </button>
      </div>

      <label>
        Motion ID
        <input
          type="text"
          value={motionId}
          onChange={(e) => setMotionId(e.target.value)}
          placeholder="例如 000 / 100 / 300"
        />
      </label>

      <div className="debug-actions">
        <button onClick={() => live2dController.playMotionById(motionId)}>
          播放动作
        </button>
        <button onClick={() => live2dController.resetToIdle()}>
          重置
        </button>
      </div>
    </div>
  );
}