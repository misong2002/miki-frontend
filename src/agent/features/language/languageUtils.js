export function createDeferred() {
  let resolve;
  let reject;

  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function getCharsPerTick(queue) {
  if (!queue) return 0;
  if (queue.length > 120) return 8;
  if (queue.length > 60) return 6;
  if (queue.length > 24) return 4;
  return 2;
}

export function takeNaturalChunk(queue) {
  if (!queue) return "";

  const punctuationRegex = /[，。！？；：\n]/;
  const charsPerTick = getCharsPerTick(queue);
  const searchWindow = queue.slice(0, Math.min(queue.length, 12));
  const punctuationIndex = searchWindow.search(punctuationRegex);

  if (punctuationIndex !== -1) {
    return queue.slice(0, punctuationIndex + 1);
  }

  return queue.slice(0, charsPerTick);
}

export function normalizeHearInput(input) {
  if (typeof input === "string") {
    return {
      text: input,
      memoryContext: null,
      messageId: `lang-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };
  }

  return {
    text: input?.text ?? "",
    memoryContext: input?.memoryContext ?? null,
    messageId:
      input?.messageId ??
      `lang-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
}