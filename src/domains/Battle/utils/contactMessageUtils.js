export function makeContactMessage({
  comment,
  epoch = null,
  timestamp = Date.now(),
}) {
  return {
    id: `contact-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    content: comment,
    createdAt: timestamp,
    epoch,
  };
}

export function normalizeContactMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .map((msg, index) => {
      if (typeof msg === "string") {
        const now = Date.now();
        return {
          id: `contact-init-${now}-${index}`,
          content: msg,
          createdAt: now,
          epoch: null,
        };
      }

      if (msg && typeof msg === "object") {
        return {
          id:
            msg.id ??
            `contact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          content: msg.content ?? "",
          createdAt: msg.createdAt ?? Date.now(),
          epoch: msg.epoch ?? null,
        };
      }

      return null;
    })
    .filter(Boolean);
}