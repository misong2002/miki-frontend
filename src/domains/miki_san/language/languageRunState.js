import { createDeferred, createMarkdownSpeechState } from "./languageUtils";

export function createLanguageRun({
  inputText,
  messageId,
  handlers = {},
  parserFactory,
}) {
  return {
    messageId,
    inputText,
    handlers,
    parser: parserFactory(),

    abortController: new AbortController(),
    deferred: createDeferred(),

    networkBuffer: "",
    displayQueue: "",
    displayedText: "",

    transferTimer: null,
    typewriterTimer: null,

    streamFinished: false,
    finalized: false,
    chatBegun: false,
    speakingStarted: false,
    speechActive: false,
    phaseSpeakingEmitted: false,
    characterEnded: false,
    markdownSpeechState: createMarkdownSpeechState(),

    finalStatus: "done",
    finalError: null,
  };
}

export function stopRunTimers(run) {
  if (run.transferTimer) {
    clearInterval(run.transferTimer);
    run.transferTimer = null;
  }

  if (run.typewriterTimer) {
    clearInterval(run.typewriterTimer);
    run.typewriterTimer = null;
  }
}

export function moveNetworkBufferToDisplayQueue(run) {
  if (!run.networkBuffer) return;
  run.displayQueue += run.networkBuffer;
  run.networkBuffer = "";
}

export function moveAllPendingTextToDisplayed(run) {
  moveNetworkBufferToDisplayQueue(run);

  if (!run.displayQueue) return;
  run.displayedText += run.displayQueue;
  run.displayQueue = "";
}

export function finalizeLanguageRun(run, payload = {}, onFinalize = null) {
  if (run.finalized) return;
  run.finalized = true;

  stopRunTimers(run);

  const result = {
    status: payload.status ?? "done",
    text: payload.text ?? run.displayedText,
    error: payload.error ?? null,
  };

  try {
    onFinalize?.(result);
  } finally {
    run.deferred.resolve(result);
  }
}