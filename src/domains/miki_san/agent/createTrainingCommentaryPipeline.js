// src/domains/miki_san/agent/createTrainingCommentaryPipeline.js

function defaultSafeCall(fn, fallback = null, label = "safeCall") {
  return Promise.resolve()
    .then(() => {
      if (typeof fn !== "function") return fallback;
      return fn();
    })
    .catch((err) => {
      console.warn(`[TrainingCommentaryPipeline] ${label} failed:`, err);
      return fallback;
    });
}

function defaultFormatBattleCommentPrefix(timestamp, epoch) {
  const d = new Date(timestamp);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const epochText = epoch != null ? `epoch ${epoch}` : "epoch ?";
  return `(${hh}:${mm}:${ss} || ${epochText})`;
}

/**
 * 训练评论流水线：
 * - perception: 从 lossData 提取 comment / feature / epoch
 * - perceptionGate: 做节流和同类抑制
 * - setTrainingStatus: 把 feature 传给角色状态机
 * - recordObservation: 持久化训练观察
 * - emitContactFeed: 广播给 battle contact panel
 */
export function createTrainingCommentaryPipeline({
  perception,
  perceptionGate,
  setTrainingStatus,
  recordObservation,
  emitContactFeed,
  safeCall = defaultSafeCall,
  formatBattleCommentPrefix = defaultFormatBattleCommentPrefix,
}) {
  if (!perception?.comment) {
    throw new Error(
      "createTrainingCommentaryPipeline: perception.comment is required"
    );
  }

  if (!perceptionGate?.shouldEmit || !perceptionGate?.markEmitted) {
    throw new Error(
      "createTrainingCommentaryPipeline: perceptionGate.shouldEmit and markEmitted are required"
    );
  }

  async function handleLossUpdate(lossData) {
    const now = Date.now();

    if (!Array.isArray(lossData) || lossData.length === 0) {
      return null;
    }

    const result = perception.comment(lossData);
    const { comment, feature, epoch } = result ?? {};

    if (!comment || !String(comment).trim()) {
      return null;
    }

    const shouldEmit = perceptionGate.shouldEmit({
      comment,
      feature,
      now,
    });

    if (!shouldEmit) {
      return null;
    }

    perceptionGate.markEmitted({
      comment,
      feature,
      now,
    });

    if (typeof setTrainingStatus === "function") {
      setTrainingStatus("running", feature);
    }

    const payload = {
      comment: `${formatBattleCommentPrefix(now, epoch)} ${comment}`,
      rawComment: comment,
      feature,
      epoch,
      timestamp: now,
    };

    await safeCall(
      () =>
        recordObservation?.({
          type: "perception_comment",
          feature,
          epoch,
          comment,
          timestamp: now,
        }),
      null,
      "recordObservation"
    );

    if (typeof emitContactFeed === "function") {
      emitContactFeed(payload);
    }

    return payload;
  }

  return {
    handleLossUpdate,
  };
}