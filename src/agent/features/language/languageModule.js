import { sendChatStream } from "../../../services/chatService";
import { createControlStreamParser } from "./controlTagParser";
import { createDeferred, takeNaturalChunk, normalizeHearInput } from "./languageUtils";


export function createLanguageModule({
  streamChat = sendChatStream,
  parserFactory = createControlStreamParser,
  transferIntervalMs = 180,
  typewriterIntervalMs = 120,
  onCharacterEvent = null,
} = {}) {
  let rememberedContext = null;
  let currentRun = null;

  function emitCharacterEvent(event) {
    if (!onCharacterEvent) return;
    onCharacterEvent(event);
  }

  function isBusy() {
    return !!currentRun;
  }

  function remind(memoryContext) {
    rememberedContext = memoryContext;
  }

  function stopTimers(run) {
    if (run.transferTimer) {
      clearInterval(run.transferTimer);
      run.transferTimer = null;
    }

    if (run.typewriterTimer) {
      clearInterval(run.typewriterTimer);
      run.typewriterTimer = null;
    }
  }

  function finalizeRun(run, payload = {}) {
    if (run.finalized) return;
    run.finalized = true;

    stopTimers(run);

    if (run.chatStarted) {
      emitCharacterEvent({
        type: "CHAT_END",
        messageId: run.messageId,
      });
    }

    currentRun = null;
    run.deferred.resolve({
      status: payload.status ?? "done",
      text: payload.text ?? run.displayedText,
      error: payload.error ?? null,
    });
  }

  function dispatchControlEvents(run, events) {
    for (const event of events) {
      run.handlers.onControl?.(event);

      if (event.type === "emotion") {
        emitCharacterEvent({
          type: "CHAT_CONTROL_EMOTION",
          value: event.value,
        });
      } else if (event.type === "motion") {
        emitCharacterEvent({
          type: "CHAT_CONTROL_MOTION",
          value: event.value,
        });
      }
    }
  }

  function handleIncomingToken(run, token) {
    if (!token || run.finalized) return;

    emitCharacterEvent({
      type: "CHAT_TOKEN",
      token,
    });

    const parsed = run.parser.push(token);

    if (parsed.events.length > 0) {
      dispatchControlEvents(run, parsed.events);
    }

    if (parsed.text) {
      run.networkBuffer += parsed.text;
    }
  }

  function flushParserRemainder(run) {
    const parsed = run.parser.flush();

    if (parsed.events.length > 0) {
      dispatchControlEvents(run, parsed.events);
    }

    if (parsed.text) {
      run.networkBuffer += parsed.text;
    }
  }

  function startTransferLoop(run) {
    if (run.transferTimer) return;

    run.transferTimer = setInterval(() => {
      if (run.finalized) return;

      const chunk = run.networkBuffer;
      if (!chunk) return;

      run.displayQueue += chunk;
      run.networkBuffer = "";
    }, transferIntervalMs);
  }

  function startTypewriterLoop(run) {
    if (run.typewriterTimer) return;

    run.typewriterTimer = setInterval(() => {
      if (run.finalized) return;

      const queue = run.displayQueue;

      if (!queue) {
        if (run.streamFinished && !run.networkBuffer && !run.displayQueue) {
          if (run.speakingStarted) {
            run.handlers.onSpeakingStop?.();
          }

          run.handlers.onDone?.(run.displayedText || "……咦，我刚刚一下子卡住了。");

          finalizeRun(run, {
            status: "done",
            text: run.displayedText || "……咦，我刚刚一下子卡住了。",
          });
        }
        return;
      }

      const chunk = takeNaturalChunk(queue);
      if (!chunk) return;

      run.displayQueue = queue.slice(chunk.length);
      run.displayedText += chunk;

      if (!run.chatStarted) {
        run.chatStarted = true;

        emitCharacterEvent({
          type: "CHAT_START",
          messageId: run.messageId,
        });

        run.handlers.onSpeakingStart?.();
      }

      run.handlers.onTextChunk?.(chunk, run.displayedText);
      run.handlers.onTextUpdate?.(
        run.displayedText || "正在思考……",
        "pending"
      );
    }, typewriterIntervalMs);
  }

  async function hear(input, handlers = {}) {
    if (currentRun) {
      throw new Error("language module is busy");
    }

    const { text, memoryContext, messageId } = normalizeHearInput(input);
    const finalMemoryContext = memoryContext ?? rememberedContext;

    const trimmed = text.trim();
    if (!trimmed) {
      return {
        status: "idle",
        text: "",
        error: null,
      };
    }

    const deferred = createDeferred();

    const run = {
      messageId,
      inputText: trimmed,
      memoryContext: finalMemoryContext, // 预留给 future prompt/agent
      handlers,
      parser: parserFactory(),

      abortController: new AbortController(),
      deferred,

      networkBuffer: "",
      displayQueue: "",
      displayedText: "",
      streamFinished: false,

      transferTimer: null,
      typewriterTimer: null,

      speakingStarted: false,
      chatStarted: false,
      finalized: false,
    };

    currentRun = run;

    handlers.onThinkingStart?.();
    handlers.onPhase?.("thinking");

    emitCharacterEvent({
      type: "USER_ACTIVE",
      source: "chat_input",
    });

    startTransferLoop(run);
    startTypewriterLoop(run);

    try {
      await streamChat(
        trimmed,
        (token) => {
          handleIncomingToken(run, token);
        },
        run.abortController.signal
      );

      flushParserRemainder(run);
      run.streamFinished = true;
    } catch (err) {
      if (err?.name === "AbortError") {
        flushParserRemainder(run);

        if (run.networkBuffer) {
          run.displayQueue += run.networkBuffer;
          run.networkBuffer = "";
        }

        if (run.displayQueue) {
          run.displayedText += run.displayQueue;
          run.displayQueue = "";
        }

        if (run.chatStarted) {
          run.handlers.onSpeakingStop?.();
        }

        run.handlers.onInterrupted?.(run.displayedText || "……");
        finalizeRun(run, {
          status: "interrupted",
          text: run.displayedText || "……",
        });

        return deferred.promise;
      }

      flushParserRemainder(run);

      if (run.networkBuffer) {
        run.displayQueue += run.networkBuffer;
        run.networkBuffer = "";
      }

      run.streamFinished = true;

      const suffix =
        run.displayedText || run.displayQueue
          ? `\n\n[流式中断：${err.message}]`
          : `请求失败：${err.message}`;

      run.displayQueue += suffix;

      const failWatcher = setInterval(() => {
        const empty = !run.networkBuffer && !run.displayQueue;

        if (empty) {
          clearInterval(failWatcher);

          if (run.chatStarted) {
            run.handlers.onSpeakingStop?.();
          }

          run.handlers.onError?.(err, run.displayedText || `请求失败：${err.message}`);

          finalizeRun(run, {
            status: "error",
            text: run.displayedText || `请求失败：${err.message}`,
            error: err,
          });
        }
      }, 50);
    }

    return deferred.promise;
  }

  function interrupt() {
    if (!currentRun) return false;

    currentRun.abortController.abort();
    return true;
  }

  return {
    remind,
    hear,
    interrupt,
    isBusy,
  };
}