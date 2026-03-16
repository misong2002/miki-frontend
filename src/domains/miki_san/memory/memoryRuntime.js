// src/domains/miki_san/memory/memoryRuntime.js

import {
  createWakeCycle,
  getLatestWakeCycle,
  getWakeCycleById,
  updateWakeCycle,
  touchWakeCycle,
  closeWakeCycle,
  appendMessage,
  createTrainingRun,
  finishTrainingRun,
  saveTrainingMetricSeries,
  listMessagesByWakeCycle,
  listTrainingRunsByWakeCycle,
  listTrainingMetricSeriesByRunId,
  appendTrainingObservation,
  getMemoryDB,
  replaceMemoryDB,
} from "./memoryStore";

import {
  archiveWakeCycleToBackend,
  fetchSystemPromptMemory,
} from "./memoryApiService";

/**
 * 判断一个 wake cycle 是否还能复用。
 * - 只有 status === "awake" 的 cycle 才能复用
 * - 距离上次活跃时间不超过 reuseWindowMs
 */
function isWakeCycleReusable(wakeCycle, reuseWindowMs) {
  if (!wakeCycle) return false;
  if (wakeCycle.status !== "awake") return false;

  const inactiveMs = Date.now() - wakeCycle.lastActiveAt;
  return inactiveMs <= reuseWindowMs;
}

function listAllWakeCyclesSorted() {
  const db = getMemoryDB();
  return [...(db.wakeCycles ?? [])].sort((a, b) => a.startAt - b.startAt);
}

function getTrainingObservationsByWakeCycle(wakeCycleId) {
  const db = getMemoryDB();
  return (db.trainingObservations ?? [])
    .filter((item) => item.wakeCycleId === wakeCycleId)
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
}

function getTrainingMetricSeriesByWakeCycle(wakeCycleId) {
  const db = getMemoryDB();
  const runIds = new Set(
    (db.trainingRuns ?? [])
      .filter((run) => run.wakeCycleId === wakeCycleId)
      .map((run) => run.id)
  );

  return (db.trainingMetricSeries ?? []).filter((series) => runIds.has(series.runId));
}

function extractWakeCycleArchivePayload(wakeCycleId) {
  const wakeCycle = getWakeCycleById(wakeCycleId);
  if (!wakeCycle) return null;

  return {
    wake_cycle_id: wakeCycleId,
    messages: listMessagesByWakeCycle(wakeCycleId),
    observations: getTrainingObservationsByWakeCycle(wakeCycleId),
    training_runs: listTrainingRunsByWakeCycle(wakeCycleId),
    force_rebuild_digest: true,
  };
}

/**
 * 创建 memory runtime。
 */
export function createMemoryRuntime(options = {}) {
  const {
    wakeCycleReuseWindowMs = 1000 * 60 * 30, // 30 分钟
    keepRecentWakeCycles = 3,
  } = options;

  let currentWakeCycle = null;
  let currentTrainingRunId = null;
  let cachedSystemPromptMemory = null;

  /**
   * 启动 memory runtime。
   * 这里只负责短期 wake cycle 的同步 boot。
   * 长期记忆归档和清理放到 archiveStaleWakeCyclesIfNeeded() 里异步做。
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

  function getCurrentWakeCycle() {
    if (!currentWakeCycle) {
      currentWakeCycle = boot();
    }
    return currentWakeCycle;
  }

  function getCurrentWakeCycleId() {
    return getCurrentWakeCycle().id;
  }

  function touch() {
    const wakeCycle = getCurrentWakeCycle();
    currentWakeCycle = touchWakeCycle(wakeCycle.id) ?? wakeCycle;
    return currentWakeCycle;
  }

  function recordUserMessage(content, meta = {}) {
    const wakeCycleId = getCurrentWakeCycleId();

    return appendMessage({
      wakeCycleId,
      role: "user",
      content,
      meta,
    });
  }

  function recordAssistantMessage(content, meta = {}) {
    const wakeCycleId = getCurrentWakeCycleId();

    return appendMessage({
      wakeCycleId,
      role: "assistant",
      content,
      meta,
    });
  }

  function recordSystemMessage(content, meta = {}) {
    const wakeCycleId = getCurrentWakeCycleId();

    return appendMessage({
      wakeCycleId,
      role: "system",
      content,
      meta,
    });
  }

  function listCurrentMessages() {
    return listMessagesByWakeCycle(getCurrentWakeCycleId());
  }

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

  function endTrainingRun(runId, status = "finished") {
    if (currentTrainingRunId === runId) {
      currentTrainingRunId = null;
    }
    return finishTrainingRun(runId, status);
  }

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

  function listCurrentTrainingRuns() {
    return listTrainingRunsByWakeCycle(getCurrentWakeCycleId());
  }

  function getTrainingMetrics(runId) {
    return listTrainingMetricSeriesByRunId(runId);
  }

  function recall({ text, messageId } = {}) {
    const messages = listCurrentMessages();
    const recentMessages = messages.slice(-12);

    return {
      wakeCycleId: getCurrentWakeCycleId(),
      query: text ?? "",
      messageId: messageId ?? null,
      recentMessages,
    };
  }

  function rememberTurn(payload = {}) {
    return {
      ok: true,
      stored: false,
      payload,
    };
  }

  async function fetchLongTermSystemPromptMemory({ force = false } = {}) {
    if (cachedSystemPromptMemory && !force) {
      return cachedSystemPromptMemory;
    }

    const result = await fetchSystemPromptMemory();
    cachedSystemPromptMemory = result;
    return result;
  }

  async function archiveWakeCycle(wakeCycleId) {
    const payload = extractWakeCycleArchivePayload(wakeCycleId);
    if (!payload) {
      return {
        ok: false,
        error: `wake cycle not found: ${wakeCycleId}`,
      };
    }

    if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
      return {
        ok: false,
        error: `wake cycle has no messages: ${wakeCycleId}`,
      };
    }

    return archiveWakeCycleToBackend(payload);
  }

  async function closeAndArchiveWakeCycle(wakeCycleId) {
    const result = await archiveWakeCycle(wakeCycleId);

    if (!result?.ok) {
      return result;
    }

    closeWakeCycle(wakeCycleId, "closed");

    if (result.summary_id) {
      updateWakeCycle(wakeCycleId, {
        summaryId: result.summary_id,
      });
    }

    return result;
  }

  function compactLocalMemory({ keepRecent = keepRecentWakeCycles } = {}) {
    const db = getMemoryDB();
    const wakeCycles = [...(db.wakeCycles ?? [])].sort((a, b) => a.startAt - b.startAt);

    if (wakeCycles.length <= keepRecent) {
      return db;
    }

    const keepWakeCycles = wakeCycles.slice(-keepRecent);
    const keepWakeCycleIds = new Set(keepWakeCycles.map((cycle) => cycle.id));

    const compactedDB = {
      wakeCycles: db.wakeCycles ?? [],
      chatMessages: (db.chatMessages ?? []).filter((msg) =>
        keepWakeCycleIds.has(msg.wakeCycleId)
      ),
      trainingRuns: (db.trainingRuns ?? []).filter((run) =>
        keepWakeCycleIds.has(run.wakeCycleId)
      ),
      trainingMetricSeries: [],
      trainingObservations: (db.trainingObservations ?? []).filter((obs) =>
        keepWakeCycleIds.has(obs.wakeCycleId)
      ),
    };

    const keepRunIds = new Set(compactedDB.trainingRuns.map((run) => run.id));

    compactedDB.trainingMetricSeries = (db.trainingMetricSeries ?? []).filter(
      (series) => keepRunIds.has(series.runId)
    );

    replaceMemoryDB(compactedDB);
    return compactedDB;
  }

  async function archiveStaleWakeCyclesIfNeeded() {
    const wakeCycles = listAllWakeCyclesSorted();
    const now = Date.now();

    const staleAwakeCycles = wakeCycles.filter((cycle) => {
      if (!cycle || cycle.status !== "awake") return false;

      const inactiveMs = now - (cycle.lastActiveAt ?? cycle.startAt ?? 0);
      return inactiveMs > wakeCycleReuseWindowMs;
    });

    const results = [];

    for (const cycle of staleAwakeCycles) {
      try {
        const result = await closeAndArchiveWakeCycle(cycle.id);
        results.push({
          wakeCycleId: cycle.id,
          ...result,
        });
      } catch (err) {
        console.warn("[memoryRuntime] archive stale wake cycle failed:", cycle.id, err);
        results.push({
          ok: false,
          wakeCycleId: cycle.id,
          error: String(err),
        });
      }
    }

    const hasSuccessfulArchive = results.some((item) => item?.ok);
    if (hasSuccessfulArchive) {
      compactLocalMemory();
    }

    return results;
  }

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

    fetchLongTermSystemPromptMemory,
    archiveWakeCycle,
    closeAndArchiveWakeCycle,
    archiveStaleWakeCyclesIfNeeded,
    compactLocalMemory,

    dump,
  };
}