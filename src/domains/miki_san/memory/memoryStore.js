// src/domains/miki_san/memory/memoryStore.js

const STORAGE_KEY = "miki_memory_v1";

/**
 * 返回当前毫秒级时间戳。
 */
function now() {
  return Date.now();
}

/**
 * 生成简单唯一 id。
 * 本地 memory 场景下已经够用了。
 */
function createId(prefix = "id") {
  return `${prefix}_${now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 创建空数据库。
 */
function createEmptyDB() {
  return {
    wakeCycles: [],
    chatMessages: [],
    trainingRuns: [],
    trainingMetricSeries: [],
    trainingObservations: [],
  };
}

/**
 * 安全 JSON.parse，避免 storage 被污染后直接崩掉。
 */
function safeParse(json, fallback) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

/**
 * 读取整个 memory DB。
 */
function loadDB() {
  if (typeof window === "undefined" || !window.localStorage) {
    return createEmptyDB();
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return createEmptyDB();

  const db = safeParse(raw, createEmptyDB());

  return {
    wakeCycles: Array.isArray(db.wakeCycles) ? db.wakeCycles : [],
    chatMessages: Array.isArray(db.chatMessages) ? db.chatMessages : [],
    trainingRuns: Array.isArray(db.trainingRuns) ? db.trainingRuns : [],
    trainingMetricSeries: Array.isArray(db.trainingMetricSeries)
      ? db.trainingMetricSeries
      : [],
    trainingObservations: Array.isArray(db.trainingObservations)
      ? db.trainingObservations
      : [],
  };
}

/**
 * 保存整个 memory DB。
 */
function saveDB(db) {
  if (typeof window === "undefined" || !window.localStorage) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

/**
 * 对外暴露：直接看整个 DB，用于 debug。
 */
export function getMemoryDB() {
  return loadDB();
}

/**
 * 对外暴露：重置 memory。
 */
export function resetMemoryDB() {
  saveDB(createEmptyDB());
}

/**
 * 创建新的 wake cycle。
 */
export function createWakeCycle() {
  const db = loadDB();

  const wakeCycle = {
    id: createId("wake"),
    startAt: now(),
    endAt: null,
    status: "awake",
    lastActiveAt: now(),
    summaryId: null,
  };

  db.wakeCycles.push(wakeCycle);
  saveDB(db);
  return wakeCycle;
}

/**
 * 获取最新 wake cycle。
 */
export function getLatestWakeCycle() {
  const db = loadDB();
  if (db.wakeCycles.length === 0) return null;

  return [...db.wakeCycles].sort((a, b) => b.startAt - a.startAt)[0];
}

/**
 * 按 id 获取 wake cycle。
 */
export function getWakeCycleById(wakeCycleId) {
  const db = loadDB();
  return db.wakeCycles.find((item) => item.id === wakeCycleId) ?? null;
}

/**
 * 更新 wake cycle。
 */
export function updateWakeCycle(wakeCycleId, patch) {
  const db = loadDB();
  const index = db.wakeCycles.findIndex((item) => item.id === wakeCycleId);
  if (index < 0) return null;

  db.wakeCycles[index] = {
    ...db.wakeCycles[index],
    ...patch,
  };

  saveDB(db);
  return db.wakeCycles[index];
}

/**
 * 用户活动时刷新 lastActiveAt。
 */
export function touchWakeCycle(wakeCycleId) {
  return updateWakeCycle(wakeCycleId, {
    lastActiveAt: now(),
  });
}

/**
 * 关闭 wake cycle。
 */
export function closeWakeCycle(wakeCycleId, status = "closed") {
  return updateWakeCycle(wakeCycleId, {
    status,
    endAt: now(),
    lastActiveAt: now(),
  });
}

/**
 * 追加一条聊天消息。
 */
export function appendMessage({
  wakeCycleId,
  role,
  content,
  meta = {},
}) {
  const db = loadDB();

  const message = {
    id: createId("msg"),
    wakeCycleId,
    role,
    content,
    createdAt: now(),
    meta: {
      emotion: meta.emotion ?? null,
      motion: meta.motion ?? null,
      interrupted: meta.interrupted ?? false,
      messageId: meta.messageId ?? null,
      error: meta.error ?? null,
    },
  };

  db.chatMessages.push(message);

  const wakeIndex = db.wakeCycles.findIndex((item) => item.id === wakeCycleId);
  if (wakeIndex >= 0) {
    db.wakeCycles[wakeIndex].lastActiveAt = now();
  }

  saveDB(db);
  return message;
}

/**
 * 获取某个 wake cycle 下的全部消息。
 */
export function listMessagesByWakeCycle(wakeCycleId) {
  const db = loadDB();

  return db.chatMessages
    .filter((item) => item.wakeCycleId === wakeCycleId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function listWakeCycles() {
  const db = loadDB();

  return [...db.wakeCycles].sort((a, b) => a.startAt - b.startAt);
}

export function listRecentWakeCycles(limit = 3) {
  const db = loadDB();

  return [...db.wakeCycles]
    .sort((a, b) => b.startAt - a.startAt)
    .slice(0, limit);
}
/**
 * 创建训练 run。
 */
export function createTrainingRun({
  wakeCycleId,
  config = {},
  modelName = null,
  dataset = null,
  meta = {},
}) {
  const now = Date.now();

  const run = {
    id: `run-${now}-${Math.random().toString(36).slice(2, 8)}`,
    wakeCycleId,
    config,
    modelName,
    dataset,
    meta,
    status: "running",
    startAt: now,
    createdAt: now,
    endAt: null,
  };

  db.trainingRuns.push(run);

  const wakeIndex = db.wakeCycles.findIndex((item) => item.id === wakeCycleId);
  if (wakeIndex >= 0) {
    db.wakeCycles[wakeIndex].lastActiveAt = now;
  }

  saveDB(db);
  return run;
}
/**
 * 更新训练 run。
 */
export function updateTrainingRun(runId, patch) {
  const db = loadDB();
  const index = db.trainingRuns.findIndex((item) => item.id === runId);
  if (index < 0) return null;

  db.trainingRuns[index] = {
    ...db.trainingRuns[index],
    ...patch,
  };

  saveDB(db);
  return db.trainingRuns[index];
}

/**
 * 结束训练 run。
 */
export function finishTrainingRun(runId, status = "finished") {
  if (!runId) {
    throw new Error("finishTrainingRun: runId is required");
  }

  return updateTrainingRun(runId, {
    status,
    endAt: Date.now(),
  });
}

/**
 * 获取 run。
 */
export function getTrainingRunById(runId) {
  const db = loadDB();
  return db.trainingRuns.find((item) => item.id === runId) ?? null;
}

/**
 * 获取某 wake cycle 下的训练 runs。
 */
export function listTrainingRunsByWakeCycle(wakeCycleId) {
  const db = loadDB();

  return db.trainingRuns
    .filter((item) => item.wakeCycleId === wakeCycleId)
    .sort((a, b) => a.startAt - b.startAt);
}

/**
 * 保存训练 metric series。
 * 同一个 runId + metricName + resolution 只保留一份最新值。
 */
export function saveTrainingMetricSeries({
  runId,
  metricName = "loss",
  resolution,
  points,
}) {
  if (!runId) {
    throw new Error("saveTrainingMetricSeries: runId is required");
  }

  if (!resolution) {
    throw new Error("saveTrainingMetricSeries: resolution is required");
  }

  const db = loadDB();

  const runExists = (db.trainingRuns ?? []).some((run) => run.id === runId);
  if (!runExists) {
    throw new Error(`saveTrainingMetricSeries: training run not found: ${runId}`);
  }

  const existingIndex = db.trainingMetricSeries.findIndex(
    (item) =>
      item.runId === runId &&
      item.metricName === metricName &&
      item.resolution === resolution
  );

  const series = {
    id:
      existingIndex >= 0
        ? db.trainingMetricSeries[existingIndex].id
        : createId("metric"),
    runId,
    metricName,
    resolution,
    points: Array.isArray(points) ? points : [],
    updatedAt: Date.now(),
  };

  if (existingIndex >= 0) {
    db.trainingMetricSeries[existingIndex] = series;
  } else {
    db.trainingMetricSeries.push(series);
  }

  saveDB(db);
  return series;
}
/**
 * 列出某个 run 的所有 metric series。
 */
export function listTrainingMetricSeriesByRunId(runId) {
  const db = loadDB();
  return db.trainingMetricSeries.filter((item) => item.runId === runId);
}

/**
 * 记录训练观察，例如 perception comment。
 */
export function appendTrainingObservation({
  runId = null,
  wakeCycleId,
  type = "observation",
  feature = null,
  epoch = null,
  comment = "",
  timestamp = now(),
}) {
  const db = loadDB();

  const observation = {
    id: createId("obs"),
    runId,
    wakeCycleId,
    type,
    feature,
    epoch,
    comment,
    timestamp,
  };

  db.trainingObservations.push(observation);
  saveDB(db);
  return observation;
}

/**
 * 列出某个 wake cycle 下的训练观察。
 */
export function listTrainingObservationsByWakeCycle(wakeCycleId) {
  const db = loadDB();

  return db.trainingObservations
    .filter((item) => item.wakeCycleId === wakeCycleId)
    .sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * 用新的 db 整体覆盖当前 memory DB。
 * 主要给 compact / migration 之类的场景使用。
 */
export function replaceMemoryDB(nextDB) {
  const safeDB = {
    wakeCycles: Array.isArray(nextDB?.wakeCycles) ? nextDB.wakeCycles : [],
    chatMessages: Array.isArray(nextDB?.chatMessages) ? nextDB.chatMessages : [],
    trainingRuns: Array.isArray(nextDB?.trainingRuns) ? nextDB.trainingRuns : [],
    trainingMetricSeries: Array.isArray(nextDB?.trainingMetricSeries)
      ? nextDB.trainingMetricSeries
      : [],
    trainingObservations: Array.isArray(nextDB?.trainingObservations)
      ? nextDB.trainingObservations
      : [],
  };

  saveDB(safeDB);
  return safeDB;
}