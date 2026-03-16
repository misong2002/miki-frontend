// src/domains/miki_san/memory/memoryTypes.js

/**
 * 本文件只保存 memory 相关的数据结构说明。
 * 运行时不会依赖这些 typedef，但它能帮助你保持字段一致。
 */

/**
 * @typedef {"awake" | "sleeping" | "closed"} WakeCycleStatus
 */

/**
 * @typedef {"user" | "assistant" | "system"} ChatRole
 */

/**
 * @typedef {"running" | "stopped" | "finished" | "failed"} TrainingRunStatus
 */

/**
 * @typedef {"recent_dense" | "global_sparse"} MetricResolution
 */

/**
 * @typedef {Object} WakeCycle
 * @property {string} id
 * @property {number} startAt
 * @property {number | null} endAt
 * @property {WakeCycleStatus} status
 * @property {number} lastActiveAt
 * @property {string | null} summaryId
 */

/**
 * @typedef {Object} ChatMessageMeta
 * @property {string | null} [emotion]
 * @property {string | null} [motion]
 * @property {boolean} [interrupted]
 * @property {string | null} [messageId]
 * @property {string | null} [error]
 */

/**
 * @typedef {Object} ChatMessage
 * @property {string} id
 * @property {string} wakeCycleId
 * @property {ChatRole} role
 * @property {string} content
 * @property {number} createdAt
 * @property {ChatMessageMeta} meta
 */

/**
 * @typedef {Object} TrainingRun
 * @property {string} id
 * @property {string} wakeCycleId
 * @property {number} startAt
 * @property {number | null} endAt
 * @property {TrainingRunStatus} status
 * @property {string | null} modelName
 * @property {string | null} dataset
 * @property {Record<string, any>} config
 */

/**
 * @typedef {Object} MetricPoint
 * @property {number} step
 * @property {number} value
 * @property {number | null} [wallTime]
 */

/**
 * @typedef {Object} TrainingMetricSeries
 * @property {string} id
 * @property {string} runId
 * @property {string} metricName
 * @property {MetricResolution} resolution
 * @property {MetricPoint[]} points
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} TrainingObservation
 * @property {string} id
 * @property {string | null} runId
 * @property {string} wakeCycleId
 * @property {string} type
 * @property {string | null} feature
 * @property {number | null} epoch
 * @property {string} comment
 * @property {number} timestamp
 */

/**
 * @typedef {Object} MemoryDB
 * @property {WakeCycle[]} wakeCycles
 * @property {ChatMessage[]} chatMessages
 * @property {TrainingRun[]} trainingRuns
 * @property {TrainingMetricSeries[]} trainingMetricSeries
 * @property {TrainingObservation[]} trainingObservations
 */