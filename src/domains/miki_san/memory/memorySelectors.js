// src/domains/miki_san/memory/memorySelectors.js

import {
  getLatestWakeCycle,
  listMessagesByWakeCycle,
  listRecentWakeCycles,
  listTrainingRunsByWakeCycle,
} from "./memoryStore";

/**
 * 获取最新 wake cycle。
 */
export function selectLatestWakeCycle() {
  return getLatestWakeCycle();
}

/**
 * 获取 UI 显示的最近消息，跨 wakeCycle
 * @param {number} limit - 消息条数
 * @param {number} wakeCycleCount - 最近几个 wakeCycle
 */
export function selectMessagesForUI(limit = 50, wakeCycleCount = 3) {
  const wakeCycles = listRecentWakeCycles(wakeCycleCount);
  if (!wakeCycles.length) return [];

  const mergedMessages = wakeCycles
    .slice() // copy
    .reverse() // 从最旧到最新
    .flatMap((wc) => listMessagesByWakeCycle(wc.id));

  mergedMessages.sort((a, b) => a.createdAt - b.createdAt);

  return mergedMessages.slice(-limit);
}

/**
 * 给 prompt 注入的上下文。
 * 这里故意更保守，避免把整个历史一股脑塞进 LLM。
 */
export function selectContextForPrompt({
  maxMessages = 200,
  maxCharsPerMessage = 10000,
} = {}) {
  const wakeCycle = getLatestWakeCycle();
  if (!wakeCycle) return [];

  const messages = listMessagesByWakeCycle(wakeCycle.id);

  return messages.slice(-maxMessages).map((msg) => ({
    role: msg.role,
    content:
      typeof msg.content === "string"
        ? msg.content.slice(-maxCharsPerMessage)
        : "",
    meta: msg.meta ?? {},
  }));
}

/**
 * 获取最新 wake cycle 对应的训练 runs。
 */
export function selectTrainingRunsForLatestWakeCycle() {
  const wakeCycle = getLatestWakeCycle();
  if (!wakeCycle) return [];

  return listTrainingRunsByWakeCycle(wakeCycle.id);
}