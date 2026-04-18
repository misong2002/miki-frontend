export function createDeferred() {
  let resolve;
  let reject;

  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

export const LANGUAGE_MESSAGE_TYPES = Object.freeze({
  USER: "user",
  INTERACTION: "interaction",
});

function createLanguageMessageId() {
  return `lang-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeLanguageMessageType(value) {
  return value === LANGUAGE_MESSAGE_TYPES.INTERACTION
    ? LANGUAGE_MESSAGE_TYPES.INTERACTION
    : LANGUAGE_MESSAGE_TYPES.USER;
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
      messageId: createLanguageMessageId(),
      messageType: LANGUAGE_MESSAGE_TYPES.USER,
    };
  }

  return {
    text: input?.text ?? "",
    messageId: input?.messageId ?? createLanguageMessageId(),
    messageType: normalizeLanguageMessageType(input?.messageType ?? input?.type),
  };
}

export function appendIfPresent(base, extra) {
  if (!extra) return base;
  return `${base}${extra}`;
}

export function isAbortError(err) {
  return err?.name === "AbortError";
}

export function createMarkdownSpeechState() {
  return {
    inFencedCodeBlock: false,
    lineStart: true,
    fenceTickCount: 0,
    fenceHeaderPending: false,
  };
}

function hasSpeakableText(text) {
  return /[^\s`]/.test(text);
}

export function inspectSpeechChunk(chunk = "", state = createMarkdownSpeechState()) {
  const nextState = {
    inFencedCodeBlock: !!state.inFencedCodeBlock,
    lineStart: state.lineStart !== false,
    fenceTickCount: state.fenceTickCount ?? 0,
    fenceHeaderPending: !!state.fenceHeaderPending,
  };

  let shouldSpeak = false;

  function consumeOutsideCode(text) {
    if (!text) return;
    if (hasSpeakableText(text)) {
      shouldSpeak = true;
    }
  }

  for (let i = 0; i < chunk.length; i += 1) {
    const ch = chunk[i];

    if (nextState.fenceHeaderPending) {
      if (ch === "\n") {
        nextState.fenceHeaderPending = false;
        nextState.lineStart = true;
      } else {
        nextState.lineStart = false;
      }
      continue;
    }

    if (nextState.inFencedCodeBlock) {
      if (nextState.lineStart) {
        if (ch === "`") {
          nextState.fenceTickCount += 1;
          if (nextState.fenceTickCount >= 3) {
            nextState.fenceHeaderPending = true;
            nextState.inFencedCodeBlock = false;
            nextState.fenceTickCount = 0;
          }
          continue;
        }

        nextState.fenceTickCount = 0;
      }

      if (ch === "\n") {
        nextState.lineStart = true;
        nextState.fenceTickCount = 0;
      } else {
        nextState.lineStart = false;
      }
      continue;
    }

    if (nextState.lineStart) {
      if (ch === "`") {
        nextState.fenceTickCount += 1;
        if (nextState.fenceTickCount >= 3) {
          nextState.fenceHeaderPending = true;
          nextState.inFencedCodeBlock = true;
          nextState.fenceTickCount = 0;
        }
        continue;
      }

      if (nextState.fenceTickCount > 0) {
        consumeOutsideCode("`".repeat(nextState.fenceTickCount));
        nextState.fenceTickCount = 0;
      }
    }

    consumeOutsideCode(ch);

    if (ch === "\n") {
      nextState.lineStart = true;
      nextState.fenceTickCount = 0;
    } else {
      nextState.lineStart = false;
    }
  }

  return {
    shouldSpeak,
    state: nextState,
  };
}
