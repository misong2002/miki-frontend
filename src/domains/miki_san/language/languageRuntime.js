import { takeNaturalChunk, isAbortError, appendIfPresent } from "./languageUtils";
import {
  createLanguageRun,
  moveAllPendingTextToDisplayed,
  moveNetworkBufferToDisplayQueue,
  finalizeLanguageRun,
} from "./languageRunState";

export function createLanguageRuntime({
  streamChat,
  parserFactory,
  transferIntervalMs = 60,
  typewriterIntervalMs = 20,
  emitCharacterEvent = null,
} = {}) {
  let currentRun = null;

  function emit(event) {
    if (!emitCharacterEvent) return;
    emitCharacterEvent(event);
  }

  function isBusy() {
    return !!currentRun;
  }

  function clearCurrentRun(run) {
    if (currentRun === run) {
      currentRun = null;
    }
  }

  function endCharacterSpeech(run) {
    if (run.characterEnded) return;
    run.characterEnded = true;

    if (run.chatBegun) {
      emit({
        type: "CHAT_END",
        messageId: run.messageId,
      });
    }
  }

  function dispatchControlEvents(run, events) {
    for (const event of events) {
      if (event.type === "emotion") {
        emit({
          type: "CHAT_CONTROL_EMOTION",
          value: event.value,
        });
      } else if (event.type === "motion") {
        emit({
          type: "CHAT_CONTROL_MOTION",
          value: event.value,
        });
      }

      run.handlers.onControl?.(event);
    }
  }

  function appendParsedOutput(run, parsed) {
    if (parsed?.events?.length) {
      dispatchControlEvents(run, parsed.events);
    }

    if (parsed?.text) {
      run.networkBuffer += parsed.text;
    }
  }

  function handleIncomingToken(run, token) {
    if (!token || run.contentFinalized) return;

    emit({
      type: "CHAT_TOKEN",
      token,
    });

    const parsed = run.parser.push(token);
    appendParsedOutput(run, parsed);
  }

  function flushParserRemainder(run) {
    const parsed = run.parser.flush();
    appendParsedOutput(run, parsed);
  }

  function getFullTextSnapshot(run) {
    return `${run.displayedText || ""}${run.displayQueue || ""}${run.networkBuffer || ""}`;
  }

  function ensureSpeakingStarted(run) {
    if (run.speakingStarted) return;

    run.speakingStarted = true;

    emit({
      type: "CHAT_SPEAK_START",
      messageId: run.messageId,
    });

    run.handlers.onSpeakingStart?.();
    run.handlers.onPhase?.("speaking");
  }

  /**
   * 只结束“内容 promise”。
   * 不会停掉 transfer/typewriter，也不会阻止 UI 继续把剩余文本播完。
   */
  function finalizeContent(run, payload = {}) {
    if (run.contentFinalized) return;
    run.contentFinalized = true;

    if (run.speakingStarted) {
      run.handlers.onSpeakingStop?.();
    }

    endCharacterSpeech(run);

    finalizeLanguageRun(
      run,
      {
        status: payload.status ?? "done",
        text: payload.text ?? run.displayedText ?? "",
        error: payload.error ?? null,
      },
      () => {
        clearCurrentRun(run);
      }
    );
  }

  /**
   * 真正的 UI drain 结束。
   * 只做善后，不再 resolve promise。
   */
  function finishDisplayDrain(run) {
    if (run.displayFinalized) return;
    run.displayFinalized = true;

    if (run.transferTimer) {
      clearInterval(run.transferTimer);
      run.transferTimer = null;
    }

    if (run.typewriterTimer) {
      clearInterval(run.typewriterTimer);
      run.typewriterTimer = null;
    }
  }

  function finalizeDone(run, finalText) {
    const text = finalText || run.displayedText || "……咦，我刚刚一下子卡住了。";

    run.handlers.onDone?.(text);
    finalizeContent(run, {
      status: "done",
      text,
      error: null,
    });
  }

  function finalizeError(run, finalText) {
    const text =
      finalText ||
      run.displayedText ||
      `请求失败：${run.finalError?.message ?? "unknown error"}`;

    run.handlers.onError?.(run.finalError, text);

    finalizeContent(run, {
      status: "error",
      text,
      error: run.finalError ?? null,
    });
  }

  function finalizeInterrupted(run, finalText) {
    const text = finalText || run.displayedText || "……";

    run.handlers.onInterrupted?.(text);

    finalizeContent(run, {
      status: "interrupted",
      text,
      error: null,
    });
  }

  function maybeFinalizeWhenDrained(run) {
    const hasPendingText = !!run.networkBuffer || !!run.displayQueue;
    if (!run.streamFinished || hasPendingText) {
      return false;
    }

    if (!run.contentFinalized) {
      if (run.finalStatus === "error") {
        finalizeError(run, run.displayedText);
      } else {
        finalizeDone(run, run.displayedText);
      }
    }

    finishDisplayDrain(run);
    return true;
  }

  function startTransferLoop(run) {
    if (run.transferTimer) return;

    run.transferTimer = setInterval(() => {
      if (run.displayFinalized) return;
      moveNetworkBufferToDisplayQueue(run);
    }, transferIntervalMs);
  }

  function startTypewriterLoop(run) {
    if (run.typewriterTimer) return;

    run.typewriterTimer = setInterval(() => {
      if (run.displayFinalized) return;

      const queue = run.displayQueue;

      if (!queue) {
        maybeFinalizeWhenDrained(run);
        return;
      }

      const chunk = takeNaturalChunk(queue);
      if (!chunk) return;

      run.displayQueue = queue.slice(chunk.length);
      run.displayedText += chunk;

      ensureSpeakingStarted(run);

      run.handlers.onTextChunk?.(chunk, run.displayedText);
      run.handlers.onTextUpdate?.(
        run.displayedText || "正在思考……",
        "pending"
      );

      maybeFinalizeWhenDrained(run);
    }, typewriterIntervalMs);
  }

  async function hear(input, handlers = {}, options = {}) {
    if (currentRun) {
      throw new Error("language module is busy");
    }

    const trimmed = String(input?.text ?? "").trim();
    const messageId = input?.messageId;
    const awaitDisplayDrain = options.awaitDisplayDrain ?? true;

    if (!trimmed) {
      return {
        status: "idle",
        text: "",
        error: null,
      };
    }

    const run = createLanguageRun({
      inputText: trimmed,
      messageId,
      handlers,
      parserFactory,
    });

    run.awaitDisplayDrain = awaitDisplayDrain;
    run.contentFinalized = false;
    run.displayFinalized = false;

    currentRun = run;

    handlers.onThinkingStart?.();
    handlers.onPhase?.("thinking");

    emit({
      type: "USER_ACTIVE",
      source: "chat_input",
    });

    emit({
      type: "CHAT_BEGIN",
      messageId,
    });

    run.chatBegun = true;

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
      run.finalStatus = "done";

      /**
       * 对 boot remind 等场景：
       * 内容一拿全就返回，不等 UI 播完。
       */
      if (!awaitDisplayDrain) {
        const fullText = getFullTextSnapshot(run) || run.displayedText || "……";
        ensureSpeakingStarted(run);

        run.handlers.onTextUpdate?.(fullText, "done");
        finalizeDone(run, fullText);
      }
    } catch (err) {
      if (isAbortError(err)) {
        flushParserRemainder(run);
        moveAllPendingTextToDisplayed(run);
        finalizeInterrupted(run, run.displayedText);
        finishDisplayDrain(run);
        return run.deferred.promise;
      }

      flushParserRemainder(run);
      moveNetworkBufferToDisplayQueue(run);

      const suffix =
        run.displayedText || run.displayQueue
          ? `\n\n[流式中断：${err.message}]`
          : `请求失败：${err.message}`;

      run.displayQueue = appendIfPresent(run.displayQueue, suffix);
      run.streamFinished = true;
      run.finalStatus = "error";
      run.finalError = err;

      if (!awaitDisplayDrain) {
        const fullText =
          getFullTextSnapshot(run) ||
          `请求失败：${err.message ?? "unknown error"}`;

        run.handlers.onTextUpdate?.(fullText, "error");
        finalizeError(run, fullText);
      }
    }

    return run.deferred.promise;
  }

  function interrupt() {
    if (!currentRun) return false;
    currentRun.abortController.abort();
    return true;
  }

  return {
    hear,
    interrupt,
    isBusy,
  };
}