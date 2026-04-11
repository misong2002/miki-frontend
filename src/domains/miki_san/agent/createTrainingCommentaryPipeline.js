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

function buildCommentaryPayload({
  now,
  epoch,
  comment,
  feature,
  formatBattleCommentPrefix,
}) {
  return {
    comment: `${formatBattleCommentPrefix(now, epoch)} ${comment}`,
    rawComment: comment,
    feature,
    epoch,
    timestamp: now,
  };
}

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

  if (!perceptionGate?.evaluate || !perceptionGate?.commit) {
    throw new Error(
      "createTrainingCommentaryPipeline: perceptionGate.evaluate and perceptionGate.commit are required"
    );
  }

  function analyzeLossUpdate(lossData) {
    const now = Date.now();

    if (!Array.isArray(lossData) || lossData.length === 0) {
      return {
        emit: false,
        reason: "empty_loss_data",
        now,
      };
    }

    const perceptionResult = perception.comment(lossData);
    const { comment, feature, epoch, rawFeature } = perceptionResult ?? {};

    /**
     * 训练语义更新不依赖 comment 是否最终发出。
     * 只要 perception 给出了 feature，就把它喂给状态机。
     */
    if (typeof setTrainingStatus === "function" && feature && feature !== "none") {
      setTrainingStatus("running", feature);
    }

    if (!comment || !String(comment).trim()) {
      return {
        emit: false,
        reason: "empty_comment",
        now,
        feature,
        rawFeature,
        epoch,
        perceptionResult,
      };
    }

    const gateDecision = perceptionGate.evaluate({
      comment,
      feature,
      epoch,
      now,
    });

    if (!gateDecision.emit) {
      return {
        emit: false,
        reason: gateDecision.reason,
        now,
        feature,
        rawFeature,
        epoch,
        comment,
        perceptionResult,
        gateDecision,
      };
    }

    const payload = buildCommentaryPayload({
      now,
      epoch,
      comment,
      feature,
      formatBattleCommentPrefix,
    });

    return {
      emit: true,
      reason: "accepted",
      now,
      feature,
      rawFeature,
      epoch,
      comment,
      payload,
      perceptionResult,
      gateDecision,
    };
  }

  async function commitCommentaryDecision(decision) {
    if (!decision?.emit || !decision.payload || !decision.gateDecision) {
      return null;
    }

    perceptionGate.commit(decision.gateDecision);

    const { now, epoch, feature, comment, payload } = decision;

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

  async function handleLossUpdate(lossData) {
    const decision = analyzeLossUpdate(lossData);
    if (!decision.emit) {
      return null;
    }
    return commitCommentaryDecision(decision);
  }

  return {
    analyzeLossUpdate,
    commitCommentaryDecision,
    handleLossUpdate,
  };
}