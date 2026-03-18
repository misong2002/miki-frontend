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

function listRecentWakeCyclesLocal(limit = 3) {
  const wakeCycles = listAllWakeCyclesSorted();
  if (!Number.isFinite(limit) || limit <= 0) return [];
  return wakeCycles.slice(-limit);
}

function listMessagesAcrossWakeCycles(wakeCycleIds = [], maxMessagesPerCycle = null) {
  const ids = Array.isArray(wakeCycleIds) ? wakeCycleIds : [];

  const allMessages = ids.flatMap((wakeCycleId) => {
    const messages = listMessagesByWakeCycle(wakeCycleId);

    if (!Number.isFinite(maxMessagesPerCycle) || maxMessagesPerCycle <= 0) {
      return messages;
    }

    return messages.slice(-maxMessagesPerCycle);
  });

  return allMessages.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
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

function isTrainingRunActive(run) {
  if (!run) return false;

  const isClosedStatus = new Set([
    "finished",
    "stopped",
    "failed",
    "closed",
    "archived",
    "cancelled",
    "superseded",
    "abandoned",
  ]);

  if (run.endAt != null) return false;
  if (run.endedAt != null) return false;
  if (run.status && isClosedStatus.has(run.status)) return false;

  return true;
}

function findLatestActiveRun(runs) {
  if (!Array.isArray(runs) || runs.length === 0) return null;

  const activeRuns = runs.filter(isTrainingRunActive);
  if (activeRuns.length === 0) return null;

  return [...activeRuns].sort((a, b) => {
    const ta = a.startAt ?? a.createdAt ?? 0;
    const tb = b.startAt ?? b.createdAt ?? 0;
    return tb - ta;
  })[0];
}

function normalizeBackendSessionKeyPart(value) {
  if (value == null) return null;
  return String(value);
}



/**
 * backend session 精确匹配逻辑：
 *
 * 1. cluster 模式优先用 jobId 匹配
 * 2. local 模式优先用 pid 匹配
 * 3. mode 相同且关键信息相同才算命中
 */
function matchBackendSession(run, sessionInfo = {}) {
  if (!run) return false;

  const runSession = run.meta?.backendSession;
  if (!runSession) return false;

  const runMode = runSession.mode ?? null;
  const queryMode = sessionInfo.mode ?? null;

  if (queryMode && runMode && queryMode !== runMode) {
    return false;
  }

  const runJobId = normalizeBackendSessionKeyPart(runSession.jobId);
  const queryJobId = normalizeBackendSessionKeyPart(sessionInfo.jobId);

  const runPid = normalizeBackendSessionKeyPart(runSession.pid);
  const queryPid = normalizeBackendSessionKeyPart(sessionInfo.pid);

  if (queryMode === "cluster") {
    return queryJobId != null && runJobId === queryJobId;
  }

  if (queryMode === "local") {
    return queryPid != null && runPid === queryPid;
  }

  if (queryJobId != null && runJobId === queryJobId) return true;
  if (queryPid != null && runPid === queryPid) return true;

  return false;
}

function listActiveTrainingRunsByBackendMode(mode = null) {
  const db = getMemoryDB();
  const runs = db.trainingRuns ?? [];

  return runs
    .filter((run) => {
      if (!isTrainingRunActive(run)) return false;

      const runMode = run.meta?.backendSession?.mode ?? null;
      if (mode == null) return true;
      return runMode === mode;
    })
    .sort((a, b) => {
      const ta = a.startAt ?? a.createdAt ?? 0;
      const tb = b.startAt ?? b.createdAt ?? 0;
      return tb - ta;
    });
}

export function createMemoryRuntime(options = {}) {

  const {
    wakeCycleReuseWindowMs = 1000 * 60 * 60 *4,
    keepRecentWakeCycles = 5,
  } = options;

  let currentWakeCycle = null;
  let currentTrainingRunId = null;
  let cachedSystemPromptMemory = null;
  let lastRememberTurnAt = 0;
  let rememberQueue = Promise.resolve();

  function closeConflictingActiveTrainingRuns({
    mode = null,
    keepRunId = null,
    nextStatus = "superseded",
  } = {}) {
    const candidates = listActiveTrainingRunsByBackendMode(mode);

    const closed = [];
    const skipped = [];

    for (const run of candidates) {
      if (!run?.id) continue;

      if (keepRunId && run.id === keepRunId) {
        skipped.push(run.id);
        continue;
      }

      const result = finishTrainingRun(run.id, nextStatus);
      closed.push({
        runId: run.id,
        result,
      });

      if (currentTrainingRunId === run.id) {
        currentTrainingRunId = null;
      }
    }

    return {
      ok: true,
      mode,
      nextStatus,
      closed,
      skipped,
    };
  }

  function reconcileTrainingRunsWithBackend({
    isRunning,
    session = null,
    nextStatusWhenMissing = "abandoned",
  } = {}) {
    if (isRunning) {
      return {
        ok: true,
        action: "noop_running",
        closed: [],
      };
    }

    const backendMode =
      session?.mode === "cluster"
        ? "cluster"
        : session?.mode === "local"
        ? "local"
        : null;

    const candidates =
      backendMode != null
        ? listActiveTrainingRunsByBackendMode(backendMode)
        : listActiveTrainingRunsByBackendMode(null);

    const closed = [];

    for (const run of candidates) {
      const result = finishTrainingRun(run.id, nextStatusWhenMissing);
      closed.push({
        runId: run.id,
        result,
      });

      if (currentTrainingRunId === run.id) {
        currentTrainingRunId = null;
      }
    }

    return {
      ok: true,
      action: "closed_missing_backend_runs",
      nextStatus: nextStatusWhenMissing,
      closed,
    };
  }

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

  function listRecentMessagesAcrossWakeCycles(
    limitWakeCycles = 3,
    maxMessagesPerCycle = null
  ) {
    const recentWakeCycles = listRecentWakeCyclesLocal(limitWakeCycles);
    const wakeCycleIds = recentWakeCycles.map((cycle) => cycle.id);

    return listMessagesAcrossWakeCycles(wakeCycleIds, maxMessagesPerCycle);
  }

  function getLatestActiveTrainingRunInCurrentWakeCycle() {
    const wakeCycleId = getCurrentWakeCycleId();
    const runs = listTrainingRunsByWakeCycle(wakeCycleId);
    return findLatestActiveRun(runs);
  }

  function getLatestActiveTrainingRunGlobally() {
    const db = getMemoryDB();
    const runs = db.trainingRuns ?? [];
    return findLatestActiveRun(runs);
  }

  function getActiveTrainingRun() {
    const db = getMemoryDB();

    if (currentTrainingRunId) {
      const current = (db.trainingRuns ?? []).find(
        (run) => run.id === currentTrainingRunId
      );
      if (current) {
        return current;
      }
      currentTrainingRunId = null;
    }

    const currentWakeCycleActiveRun = getLatestActiveTrainingRunInCurrentWakeCycle();
    if (currentWakeCycleActiveRun) {
      currentTrainingRunId = currentWakeCycleActiveRun.id;
      return currentWakeCycleActiveRun;
    }

    const globalActiveRun = getLatestActiveTrainingRunGlobally();
    if (globalActiveRun) {
      currentTrainingRunId = globalActiveRun.id;
      return globalActiveRun;
    }

    return null;
  }

  function getActiveTrainingRunId() {
    return getActiveTrainingRun()?.id ?? null;
  }

  function ensureActiveTrainingRunId(runId = null) {
    if (runId) {
      currentTrainingRunId = runId;
      return runId;
    }
    return getActiveTrainingRunId();
  }

  function startTrainingRun({
    config = {},
    modelName = null,
    dataset = null,
    meta = {},
  } = {}) {
    const wakeCycleId = getCurrentWakeCycleId();

    const run = createTrainingRun({
      wakeCycleId,
      config,
      modelName,
      dataset,
      meta,
    });

    currentTrainingRunId = run.id;
    return run;
  }

  function endTrainingRun(runId = null, status = "finished") {
    const resolvedRunId = ensureActiveTrainingRunId(runId);

    if (!resolvedRunId) {
      return {
        ok: false,
        error: "no active training run to finish",
      };
    }

    const result = finishTrainingRun(resolvedRunId, status);

    if (currentTrainingRunId === resolvedRunId) {
      currentTrainingRunId = null;
    }

    return result;
  }

  function saveLossSeries(
    runId = null,
    { recentDense = [], globalSparse = [] } = {}
  ) {
    const resolvedRunId = ensureActiveTrainingRunId(runId);

    if (!resolvedRunId) {
      return {
        ok: false,
        error: "no active training run to save loss series",
      };
    }

    const result = { runId: resolvedRunId };

    if (recentDense.length > 0) {
      result.recentDense = saveTrainingMetricSeries({
        runId: resolvedRunId,
        metricName: "loss",
        resolution: "recent_dense",
        points: recentDense,
      });
    }

    if (globalSparse.length > 0) {
      result.globalSparse = saveTrainingMetricSeries({
        runId: resolvedRunId,
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
    runId = null,
  } = {}) {
    const wakeCycleId = getCurrentWakeCycleId();
    const resolvedRunId = ensureActiveTrainingRunId(runId);

    return appendTrainingObservation({
      runId: resolvedRunId,
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

  function getTrainingMetrics(runId = null) {
    const resolvedRunId = ensureActiveTrainingRunId(runId);
    if (!resolvedRunId) return [];
    return listTrainingMetricSeriesByRunId(resolvedRunId);
  }

  /**
   * 按后端 session 精确查找 training run。
   * 命中后会同步 currentTrainingRunId。
   */
  function getTrainingRunByBackendSession({
    jobId = null,
    pid = null,
    mode = null,
  } = {}) {
    const db = getMemoryDB();
    const runs = db.trainingRuns ?? [];

    const matched = [...runs]
      .filter((run) => matchBackendSession(run, { jobId, pid, mode }))
      .sort((a, b) => {
        const ta = a.startAt ?? a.createdAt ?? 0;
        const tb = b.startAt ?? b.createdAt ?? 0;
        return tb - ta;
      })[0] ?? null;

    if (matched?.id) {
      currentTrainingRunId = matched.id;
    }

    return matched;
  }

  /**
   * 给某个 run 写回 backend session 元信息。
   * 这里直接在 DB 中更新 trainingRuns 对象。
   */
  function setTrainingRunBackendSession(
    runId,
    { mode = null, jobId = null, pid = null } = {}
  ) {
    if (!runId) {
      return {
        ok: false,
        error: "runId is required",
      };
    }

    const db = getMemoryDB();
    const runs = db.trainingRuns ?? [];
    const index = runs.findIndex((run) => run.id === runId);

    if (index < 0) {
      return {
        ok: false,
        error: `training run not found: ${runId}`,
      };
    }

    const nextRuns = [...runs];
    const prevRun = nextRuns[index];

    nextRuns[index] = {
      ...prevRun,
      meta: {
        ...(prevRun.meta ?? {}),
        backendSession: {
          mode,
          jobId,
          pid,
        },
      },
    };

    replaceMemoryDB({
      ...db,
      trainingRuns: nextRuns,
    });

    if (currentTrainingRunId === runId) {
      currentTrainingRunId = runId;
    }

    return {
      ok: true,
      run: nextRuns[index],
    };
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
      mode: "wake_cycle_only",
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

    const activeRun = getActiveTrainingRun();
    if (activeRun?.wakeCycleId === wakeCycleId) {
      currentTrainingRunId = null;
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
      wakeCycles: (db.wakeCycles ?? []).filter((cycle) =>
        keepWakeCycleIds.has(cycle.id)
      ),
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

    if (currentWakeCycle && !keepWakeCycleIds.has(currentWakeCycle.id)) {
      currentWakeCycle = null;
    }

    if (currentTrainingRunId && !keepRunIds.has(currentTrainingRunId)) {
      currentTrainingRunId = null;
    }

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
    getActiveTrainingRun,
    getActiveTrainingRunId,
    getTrainingRunByBackendSession,
    setTrainingRunBackendSession,
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
    listRecentMessagesAcrossWakeCycles,

    dump,

    closeConflictingActiveTrainingRuns,
    reconcileTrainingRunsWithBackend,
  };
}

