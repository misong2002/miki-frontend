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
 * 给 UI 显示的最近消息。
 */
export function selectMessagesForUI(limit = 50, wakeCycleCount = 3) {
  const wakeCycles = listRecentWakeCycles(wakeCycleCount);
  if (!wakeCycles.length) return [];

  /**
   * 先取最近 3 个 wake cycle，
   * 但为了按时间正序显示，需要再反转回来：
   * 最旧 → 最新
   */
  const orderedWakeCycles = [...wakeCycles].reverse();

  const mergedMessages = orderedWakeCycles.flatMap((cycle) =>
    listMessagesByWakeCycle(cycle.id)
  );

  /**
   * 再按 createdAt 做一次全局排序，防止边界时序乱掉
   */
  mergedMessages.sort((a, b) => a.createdAt - b.createdAt);

  return mergedMessages.slice(-limit);
}


/**
 * 给 prompt 注入的上下文。
 * 这里故意更保守，避免把整个历史一股脑塞进 LLM。
 */
export function selectContextForPrompt({
  maxMessages = 12,
  maxCharsPerMessage = 1200,
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