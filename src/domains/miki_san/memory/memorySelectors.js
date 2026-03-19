import {
  getLatestWakeCycle,
  listMessagesByWakeCycle,
  listRecentWakeCycles,
  listTrainingRunsByWakeCycle,
} from "./memoryStore";

function truncateText(text, maxChars) {
  const s = typeof text === "string" ? text : "";
  if (!Number.isFinite(maxChars) || maxChars <= 0) return "";
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}…`;
}

export function selectLatestWakeCycle() {
  return getLatestWakeCycle();
}

export function selectMessagesForUI(limit = 50, wakeCycleCount = 3) {
  const wakeCycles = listRecentWakeCycles(wakeCycleCount);
  if (!wakeCycles.length) return [];

  const mergedMessages = wakeCycles
    .slice()
    .reverse()
    .flatMap((wc) => listMessagesByWakeCycle(wc.id));

  mergedMessages.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

  return mergedMessages.slice(-limit);
}

export function selectContextForPrompt({
  maxMessages = 24,
  maxCharsPerMessage = 600,
} = {}) {
  const wakeCycle = getLatestWakeCycle();
  if (!wakeCycle) return [];

  const messages = listMessagesByWakeCycle(wakeCycle.id);

  return messages.slice(-maxMessages).map((msg) => ({
    role: msg.role,
    content: truncateText(msg.content, maxCharsPerMessage),
    meta: msg.meta ?? {},
  }));
}

export function selectTrainingRunsForLatestWakeCycle() {
  const wakeCycle = getLatestWakeCycle();
  if (!wakeCycle) return [];

  return listTrainingRunsByWakeCycle(wakeCycle.id);
}