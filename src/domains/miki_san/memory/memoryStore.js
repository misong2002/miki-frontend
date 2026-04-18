// src/domains/miki_san/memory/memoryStore.js
const STORAGE_KEY = "miki_memory_v2";
const LEGACY_STORAGE_KEY = "miki_memory_v1";

function now() {
  return Date.now();
}

function createId(prefix = "id") {
  return `${prefix}_${now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyDB() {
  return {
    wakeCycles: [],
    chatMessages: [],
    trainingRuns: [],
    trainingObservations: [],
    meta: {
      schemaVersion: 2,
      migratedFromSchemaVersion: null,
      droppedLegacyFields: [],
      lastCompactedAt: null,
      lastSavedAt: null,
    },
  };
}

function safeParse(json, fallback) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

function inferSchemaVersion(db) {
  if (Number.isFinite(db?.meta?.schemaVersion)) {
    return db.meta.schemaVersion;
  }

  if (Array.isArray(db?.trainingMetricSeries)) {
    return 1;
  }

  return 1;
}

function normalizeDB(db) {
  const source = db ?? {};
  const inferredSchemaVersion = inferSchemaVersion(source);

  const droppedLegacyFields = [];
  if (Array.isArray(source?.trainingMetricSeries)) {
    droppedLegacyFields.push("trainingMetricSeries");
  }

  return {
    wakeCycles: Array.isArray(source?.wakeCycles) ? source.wakeCycles : [],
    chatMessages: Array.isArray(source?.chatMessages) ? source.chatMessages : [],
    trainingRuns: Array.isArray(source?.trainingRuns) ? source.trainingRuns : [],
    trainingObservations: Array.isArray(source?.trainingObservations)
      ? source.trainingObservations
      : [],
    meta: {
      schemaVersion: 2,
      migratedFromSchemaVersion:
        inferredSchemaVersion === 2 ? null : inferredSchemaVersion,
      droppedLegacyFields,
      lastCompactedAt: source?.meta?.lastCompactedAt ?? null,
      lastSavedAt: source?.meta?.lastSavedAt ?? null,
    },
  };
}

let memoryCache = null;

function writeNormalizedV2ToStorage(db) {
  if (typeof window === "undefined" || !window.localStorage) return;

  const normalized = normalizeDB(db);

  const nextDB = {
    ...normalized,
    meta: {
      ...normalized.meta,
      schemaVersion: 2,
      lastSavedAt: now(),
    },
  };

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextDB));

  if (STORAGE_KEY !== LEGACY_STORAGE_KEY) {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  }
}

function readFromStorage() {
  if (typeof window === "undefined" || !window.localStorage) {
    return createEmptyDB();
  }

  const rawV2 = window.localStorage.getItem(STORAGE_KEY);
  if (rawV2) {
    const parsed = safeParse(rawV2, createEmptyDB());
    return normalizeDB(parsed);
  }

  const rawLegacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  if (rawLegacy) {
    const parsedLegacy = safeParse(rawLegacy, createEmptyDB());
    const migrated = normalizeDB(parsedLegacy);

    // 强制迁移：只要读到了 v1，就立刻写成 v2 并删除 v1
    writeNormalizedV2ToStorage(migrated);

    return migrated;
  }

  return createEmptyDB();
}

function ensureCache() {
  if (!memoryCache) {
    memoryCache = readFromStorage();
  }
  return memoryCache;
}

function commitDB(mutator) {
  const base = normalizeDB(ensureCache());
  const next = normalizeDB(mutator(base) ?? base);
  memoryCache = next;
  writeNormalizedV2ToStorage(next);
  return next;
}

export function getMemoryDB() {
  return normalizeDB(ensureCache());
}

export function reloadMemoryDB() {
  memoryCache = readFromStorage();
  return memoryCache;
}

export function resetMemoryDB() {
  memoryCache = createEmptyDB();
  writeNormalizedV2ToStorage(memoryCache);
  return memoryCache;
}

export function clearMemoryDB() {
  return resetMemoryDB();
}

export function estimateMemoryDBSize() {
  const db = getMemoryDB();
  try {
    return JSON.stringify(db).length;
  } catch {
    return 0;
  }
}

export function replaceMemoryDB(nextDB) {
  const safeDB = normalizeDB(nextDB);
  memoryCache = safeDB;
  writeNormalizedV2ToStorage(safeDB);
  return safeDB;
}

export function createWakeCycle() {
  const wakeCycle = {
    id: createId("wake"),
    startAt: now(),
    endAt: null,
    status: "awake",
    lastActiveAt: now(),
    summaryId: null,
  };

  commitDB((db) => {
    db.wakeCycles.push(wakeCycle);
    return db;
  });

  return wakeCycle;
}

export function listWakeCycles() {
  const db = getMemoryDB();
  return [...db.wakeCycles].sort((a, b) => (a.startAt ?? 0) - (b.startAt ?? 0));
}

export function listRecentWakeCycles(limit = 3) {
  const db = getMemoryDB();
  return [...db.wakeCycles]
    .sort((a, b) => (b.startAt ?? 0) - (a.startAt ?? 0))
    .slice(0, Math.max(0, limit));
}

export function getLatestWakeCycle() {
  return listRecentWakeCycles(1)[0] ?? null;
}

export function getWakeCycleById(wakeCycleId) {
  const db = getMemoryDB();
  return db.wakeCycles.find((item) => item.id === wakeCycleId) ?? null;
}

export function updateWakeCycle(wakeCycleId, patch) {
  let updated = null;

  commitDB((db) => {
    const index = db.wakeCycles.findIndex((item) => item.id === wakeCycleId);
    if (index < 0) return db;

    db.wakeCycles[index] = {
      ...db.wakeCycles[index],
      ...patch,
    };
    updated = db.wakeCycles[index];
    return db;
  });

  return updated;
}

export function touchWakeCycle(wakeCycleId) {
  return updateWakeCycle(wakeCycleId, {
    lastActiveAt: now(),
  });
}

export function closeWakeCycle(wakeCycleId, status = "closed") {
  return updateWakeCycle(wakeCycleId, {
    status,
    endAt: now(),
    lastActiveAt: now(),
  });
}

export function appendMessage({
  wakeCycleId,
  role,
  content,
  meta = {},
}) {
  const timestamp = now();

  const message = {
    id: createId("msg"),
    wakeCycleId,
    role,
    content,
    createdAt: timestamp,
    meta: {
      emotion: meta.emotion ?? null,
      motion: meta.motion ?? null,
      interrupted: meta.interrupted ?? false,
      messageId: meta.messageId ?? null,
      error: meta.error ?? null,
      source: meta.source ?? null,
      messageType: meta.messageType ?? null,
    },
  };

  commitDB((db) => {
    db.chatMessages.push(message);

    const wakeIndex = db.wakeCycles.findIndex((item) => item.id === wakeCycleId);
    if (wakeIndex >= 0) {
      db.wakeCycles[wakeIndex].lastActiveAt = timestamp;
    }

    return db;
  });

  return message;
}

export function listMessagesByWakeCycle(wakeCycleId) {
  const db = getMemoryDB();

  return db.chatMessages
    .filter((item) => item.wakeCycleId === wakeCycleId)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

export function createTrainingRun({
  wakeCycleId,
  config = {},
  modelName = null,
  dataset = null,
  meta = {},
}) {
  const ts = now();

  const run = {
    id: `run-${ts}-${Math.random().toString(36).slice(2, 8)}`,
    wakeCycleId,
    config,
    modelName,
    dataset,
    meta,
    status: "running",
    startAt: ts,
    createdAt: ts,
    endAt: null,
  };

  commitDB((db) => {
    db.trainingRuns.push(run);

    const wakeIndex = db.wakeCycles.findIndex((item) => item.id === wakeCycleId);
    if (wakeIndex >= 0) {
      db.wakeCycles[wakeIndex].lastActiveAt = ts;
    }

    return db;
  });

  return run;
}

export function getTrainingRunById(runId) {
  const db = getMemoryDB();
  return db.trainingRuns.find((item) => item.id === runId) ?? null;
}

export function updateTrainingRun(runId, patch) {
  let updated = null;

  commitDB((db) => {
    const index = db.trainingRuns.findIndex((item) => item.id === runId);
    if (index < 0) return db;

    db.trainingRuns[index] = {
      ...db.trainingRuns[index],
      ...patch,
    };
    updated = db.trainingRuns[index];
    return db;
  });

  return updated;
}

export function finishTrainingRun(runId, status = "finished") {
  if (!runId) {
    throw new Error("finishTrainingRun: runId is required");
  }

  return updateTrainingRun(runId, {
    status,
    endAt: now(),
  });
}

export function listTrainingRunsByWakeCycle(wakeCycleId) {
  const db = getMemoryDB();

  return db.trainingRuns
    .filter((item) => item.wakeCycleId === wakeCycleId)
    .sort((a, b) => (a.startAt ?? 0) - (b.startAt ?? 0));
}

export function appendTrainingObservation({
  runId = null,
  wakeCycleId,
  type = "observation",
  feature = null,
  epoch = null,
  comment = "",
  timestamp = now(),
}) {
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

  commitDB((db) => {
    db.trainingObservations.push(observation);
    return db;
  });

  return observation;
}

export function listTrainingObservationsByWakeCycle(wakeCycleId) {
  const db = getMemoryDB();

  return db.trainingObservations
    .filter((item) => item.wakeCycleId === wakeCycleId)
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
}