// src/domains/miki_san/memory/memoryRuntime.js

import {
  createWakeCycle,
  getLatestWakeCycle,
  touchWakeCycle,
  appendMessage,
  createTrainingRun,
  finishTrainingRun,
  saveTrainingMetricSeries,
  listMessagesByWakeCycle,
  listTrainingRunsByWakeCycle,
  listTrainingMetricSeriesByRunId,
  appendTrainingObservation,
  getMemoryDB,
} from "./memoryStore";

/**
 * 判断一个 wake cycle 是否还能复用。
 * 这里的策略是：
 * - 只有 status === "awake" 的 cycle 才能复用
 * - 距离上次活跃时间不超过 reuseWindowMs
 */
function isWakeCycleReusable(wakeCycle, reuseWindowMs) {
  if (!wakeCycle) return false;
  if (wakeCycle.status !== "awake") return false;

  const inactiveMs = Date.now() - wakeCycle.lastActiveAt;
  return inactiveMs <= reuseWindowMs;
}

/**
 * 创建 memory runtime。
 *
 * 说明：
 * - 这里先做本地版，不做长期记忆和摘要
 * - recall / rememberTurn 先给空实现，保证接口兼容
 */
export function createMemoryRuntime(options = {}) {
  const {
    wakeCycleReuseWindowMs = 1000 * 60 * 30, // 30 分钟内复用旧 wake cycle
  } = options;

  let currentWakeCycle = null;
  let currentTrainingRunId = null;

  /**
   * 启动 memory runtime。
   * 优先复用旧 cycle，否则新建。
   */
  function boot() {
    const latest = getLatestWakeCycle();

    if (isWakeCycleReusable(latest, wakeCycleReuseWindowMs)) {
      currentWakeCycle = latest;
      touchWakeCycle(currentWakeCycle.id);
      return currentWakeCycle;
    }

    currentWakeCycle = createWakeCycle();
    return currentWakeCycle;
  }

  /**
   * 获取当前 wake cycle，没有就自动 boot。
   */
  function getCurrentWakeCycle() {
    if (!currentWakeCycle) {
      currentWakeCycle = boot();
    }
    return currentWakeCycle;
  }

  /**
   * 获取当前 wake cycle id。
   */
  function getCurrentWakeCycleId() {
    return getCurrentWakeCycle().id;
  }

  /**
   * 标记当前用户仍活跃。
   */
  function touch() {
    const wakeCycle = getCurrentWakeCycle();
    currentWakeCycle = touchWakeCycle(wakeCycle.id) ?? wakeCycle;
    return currentWakeCycle;
  }

  /**
   * 写入 user message。
   */
  function recordUserMessage(content, meta = {}) {
    const wakeCycleId = getCurrentWakeCycleId();

    return appendMessage({
      wakeCycleId,
      role: "user",
      content,
      meta,
    });
  }

  /**
   * 写入 assistant message。
   */
  function recordAssistantMessage(content, meta = {}) {
    const wakeCycleId = getCurrentWakeCycleId();

    return appendMessage({
      wakeCycleId,
      role: "assistant",
      content,
      meta,
    });
  }

  /**
   * 写入 system message。
   */
  function recordSystemMessage(content, meta = {}) {
    const wakeCycleId = getCurrentWakeCycleId();

    return appendMessage({
      wakeCycleId,
      role: "system",
      content,
      meta,
    });
  }

  /**
   * 获取当前 cycle 的消息。
   */
  function listCurrentMessages() {
    return listMessagesByWakeCycle(getCurrentWakeCycleId());
  }

  /**
   * 启动一次训练 run。
   */
  function startTrainingRun({
    config = {},
    modelName = null,
    dataset = null,
  } = {}) {
    const wakeCycleId = getCurrentWakeCycleId();

    const run = createTrainingRun({
      wakeCycleId,
      config,
      modelName,
      dataset,
    });

    currentTrainingRunId = run.id;
    return run;
  }

  /**
   * 结束训练 run。
   */
  function endTrainingRun(runId, status = "finished") {
    if (currentTrainingRunId === runId) {
      currentTrainingRunId = null;
    }
    return finishTrainingRun(runId, status);
  }

  /**
   * 保存两份 loss 曲线：
   * - recentDense：最近一段高分辨率
   * - globalSparse：全程稀疏采样
   */
  function saveLossSeries(runId, { recentDense = [], globalSparse = [] } = {}) {
    const result = {};

    if (recentDense.length > 0) {
      result.recentDense = saveTrainingMetricSeries({
        runId,
        metricName: "loss",
        resolution: "recent_dense",
        points: recentDense,
      });
    }

    if (globalSparse.length > 0) {
      result.globalSparse = saveTrainingMetricSeries({
        runId,
        metricName: "loss",
        resolution: "global_sparse",
        points: globalSparse,
      });
    }

    return result;
  }

  /**
   * 记录 perception/comment 等训练观察。
   */
  function recordTrainingObservation({
    type = "observation",
    feature = null,
    epoch = null,
    comment = "",
    timestamp = Date.now(),
    runId = currentTrainingRunId,
  } = {}) {
    const wakeCycleId = getCurrentWakeCycleId();

    return appendTrainingObservation({
      runId,
      wakeCycleId,
      type,
      feature,
      epoch,
      comment,
      timestamp,
    });
  }

  /**
   * 获取当前 wake cycle 下的训练 runs。
   */
  function listCurrentTrainingRuns() {
    return listTrainingRunsByWakeCycle(getCurrentWakeCycleId());
  }

  /**
   * 获取指定 run 的曲线。
   */
  function getTrainingMetrics(runId) {
    return listTrainingMetricSeriesByRunId(runId);
  }

  /**
   * 召回短期上下文。
   * 当前版本先简单返回最近几条消息，供语言模块使用。
   */
  function recall({ text, messageId } = {}) {
    const messages = listCurrentMessages();
    const recentMessages = messages.slice(-200);

    return {
      wakeCycleId: getCurrentWakeCycleId(),
      query: text ?? "",
      messageId: messageId ?? null,
      recentMessages,
    };
  }

  /**
   * rememberTurn：
   * 当前本地版本先不做复杂摘要，只保留接口。
   * 后续你做长期记忆和 summary 时，可以在这里扩展。
   */
  function rememberTurn(payload = {}) {
    return {
      ok: true,
      stored: false,
      payload,
    };
  }

  /**
   * debug：直接 dump 整个 DB。
   */
  function dump() {
    return getMemoryDB();
  }

  return {
    boot,
    touch,
    getCurrentWakeCycle,
    getCurrentWakeCycleId,

    recordUserMessage,
    recordAssistantMessage,
    recordSystemMessage,
    listCurrentMessages,

    startTrainingRun,
    endTrainingRun,
    saveLossSeries,
    recordTrainingObservation,
    listCurrentTrainingRuns,
    getTrainingMetrics,

    recall,
    rememberTurn,

    dump,
  };
}