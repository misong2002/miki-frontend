// src/hooks/useChatBootstrap.js
import { useEffect, useMemo, useState } from "react";

const SUMMARIZING_HINTS = [
  "正在净化灵魂宝石……",
  "正在射杀白色孽畜……",
  "正在检查悲叹之种库存……",
  "正在向圆环之理提交祈愿……",
  "正在整理见泷原结界作战记录……",
  "正在确认今天没有人乱签契约……",
];

function upsertMessage(messages, nextMessage) {
  const list = Array.isArray(messages) ? messages : [];
  const index = list.findIndex((item) => item?.id === nextMessage.id);

  if (index === -1) {
    return [...list, nextMessage];
  }

  const next = [...list];
  next[index] = {
    ...next[index],
    ...nextMessage,
    meta: {
      ...(next[index]?.meta ?? {}),
      ...(nextMessage?.meta ?? {}),
    },
  };
  return next;
}

function removeMessage(messages, messageId) {
  if (!Array.isArray(messages) || !messageId) return messages;
  return messages.filter((item) => item?.id !== messageId);
}

export function useChatBootstrap({
  chatAgent,
  appAgent,
  mode,
  chatModeValue,
}) {
  const [chatBootReady, setChatBootReady] = useState(false);
  const [initialChatMessages, setInitialChatMessages] = useState([]);
  const [bootPhase, setBootPhase] = useState("idle");
  const [hintIndex, setHintIndex] = useState(0);
  const [hasDeferredRemindRun, setHasDeferredRemindRun] = useState(false);
  const [isDeferredRemindActive, setIsDeferredRemindActive] = useState(false);

  function setBootPhaseWithLog(nextPhase, reason = "") {
    console.log("[chat/bootstrap] boot phase ->", nextPhase, { reason });
    setBootPhase(nextPhase);
  }

  const isSummarizingPhase =
    bootPhase === "archiving" || bootPhase === "compacting";
  const shouldRotateLoadingHints =
    !chatBootReady && !isDeferredRemindActive && bootPhase !== "error";

  useEffect(() => {
    if (!shouldRotateLoadingHints) return;

    const timer = window.setInterval(() => {
      setHintIndex((prev) => {
        if (SUMMARIZING_HINTS.length <= 1) return 0;

        let next = prev;
        while (next === prev) {
          next = Math.floor(Math.random() * SUMMARIZING_HINTS.length);
        }

        return next;
      });
    }, 1600);

    return () => {
      window.clearInterval(timer);
    };
  }, [shouldRotateLoadingHints]);

  useEffect(() => {
    if (!appAgent?.subscribeBootPhase) return undefined;

    return appAgent.subscribeBootPhase(({ phase } = {}) => {
      if (!phase) return;
      setBootPhaseWithLog(phase, "app_agent.subscribeBootPhase");
    });
  }, [appAgent]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapChat() {
      console.log("[chat/bootstrap] bootstrap requested:", { mode, chatModeValue });
      if (mode !== chatModeValue) {
        console.log("[chat/bootstrap] skipped because app is not in chat mode");
        return;
      }

      console.log("[chat/bootstrap] starting app agent bootstrap");
      setChatBootReady(false);
      console.log("[chat/bootstrap] chat boot ready -> false", { reason: "bootstrap_start" });
      setBootPhaseWithLog("archiving", "bootstrap_start");
      setHintIndex(0);

      try {
        await appAgent?.start?.({
          deferRemind: true,
        });

        const restoredMessages =
          (await chatAgent?.getBootstrapMessages?.()) ?? [];

        if (cancelled) return;
        console.log("[chat/bootstrap] restored bootstrap messages:", restoredMessages.length);
        setInitialChatMessages(restoredMessages);
        console.log("[chat/bootstrap] bootstrap restored initial messages", { count: restoredMessages.length });
        setBootPhaseWithLog("ready", "bootstrap_complete");
        setHasDeferredRemindRun(false);
        console.log("[chat/bootstrap] bootstrap complete");
      } catch (err) {
        console.warn("[useChatBootstrap] bootstrapChat failed:", err);

        if (cancelled) return;
        setInitialChatMessages([]);
        setBootPhaseWithLog("error", "bootstrap_failed");
      } finally {
        if (cancelled) return;
        console.log("[chat/bootstrap] chat boot ready -> true", { reason: "bootstrap_finally" });
        setChatBootReady(true);
      }
    }

    bootstrapChat();

    return () => {
      cancelled = true;
    };
  }, [chatAgent, appAgent, mode, chatModeValue]);

  useEffect(() => {
    let cancelled = false;

    function appendDeferredRemindMessage(prevMessages, remindResult) {
      if (!Array.isArray(prevMessages)) return prevMessages;

      const text = remindResult?.text?.trim?.() ?? "";
      const messageId = remindResult?.messageId ?? null;

      if (!text) return prevMessages;

      if (messageId && prevMessages.some((msg) => msg?.id === messageId)) {
        return prevMessages;
      }

      return [
        ...prevMessages,
        {
          id: messageId ?? `boot-remind-${Date.now()}`,
          role: "assistant",
          content: text,
          createdAt: Date.now(),
          status: "done",
          meta: {
            ...(remindResult?.meta ?? {}),
          },
        },
      ];
    }

    async function runDeferredRemind() {
      const startedAt = Date.now();
      if (mode !== chatModeValue) return;
      if (!chatBootReady) return;
      if (bootPhase !== "ready") return;
      if (hasDeferredRemindRun) return;

      console.log("[chat/bootstrap] deferred remind check", {
        hasRemind: Boolean(chatAgent?.remind),
        hasPendingTrainingSummary:
          appAgent?.hasPendingTrainingSummaryPrompt?.() ?? false,
      });

      const hasPendingTrainingSummary =
        appAgent?.hasPendingTrainingSummaryPrompt?.() ?? false;

      if (!chatAgent?.remind && !hasPendingTrainingSummary) return;

      console.log("[chat/bootstrap] deferred remind start", { startedAt });
      setHasDeferredRemindRun(true);
      setIsDeferredRemindActive(true);
      setBootPhaseWithLog("reminding", "deferred_remind_start");

      const streamingMessageId = `boot-remind-stream-${Date.now()}`;
      const createdAt = Date.now();
      const patchStreamingMessage = (content = "", status = "pending", meta = {}) => {
        setInitialChatMessages((prev) =>
          upsertMessage(prev, {
            id: streamingMessageId,
            role: "assistant",
            content,
            createdAt,
            status,
            meta: {
              source: "boot_remind",
              bootStreaming: true,
              ...meta,
            },
          })
        );
      };

      try {
        let remindResult = {
          status: "idle",
          text: "",
          error: null,
          messageId: null,
          meta: {},
        };

        if (chatAgent?.remind) {
          remindResult = await chatAgent.remind({
            onThinkingStart: () => {
              if (cancelled) return;
              patchStreamingMessage("", "pending", { thinking: true });
            },
            onTextUpdate: (fullText) => {
              if (cancelled) return;
              patchStreamingMessage(fullText || "", "pending");
            },
            onDone: (finalText) => {
              if (cancelled) return;
              patchStreamingMessage(finalText || "……", "done");
            },
            onInterrupted: (partialText) => {
              if (cancelled) return;
              patchStreamingMessage(
                `${partialText || "……"}

[回想被中断]`,
                "done",
                { interrupted: true }
              );
            },
            onError: (err, partialText) => {
              if (cancelled) return;
              patchStreamingMessage(
                partialText || `回想失败：${err?.message ?? "unknown error"}`,
                "error",
                { error: String(err?.message ?? err ?? "unknown error") }
              );
            },
          });
        }

        if (cancelled) return;
        console.log("[chat/bootstrap] deferred remind result:", {
          durationMs: Date.now() - startedAt,
          status: remindResult?.status,
          hasText: Boolean(remindResult?.text?.trim?.()),
          messageId: remindResult?.messageId ?? null,
        });

        if (!remindResult?.text?.trim?.()) {
          setInitialChatMessages((prev) => removeMessage(prev, streamingMessageId));
        }

        if (
          remindResult?.status === "idle" &&
          (appAgent?.hasPendingTrainingSummaryPrompt?.() ?? false) &&
          chatAgent?.runPendingTrainingSummaryQuery
        ) {
          console.log("[chat/bootstrap] pending training summary query start", { durationMs: Date.now() - startedAt });
          const trainingSummaryResult =
            await chatAgent.runPendingTrainingSummaryQuery();

          if (cancelled) return;
          console.log("[chat/bootstrap] ran pending training summary query:", {
            durationMs: Date.now() - startedAt,
            status: trainingSummaryResult?.status,
            hasText: Boolean(trainingSummaryResult?.text?.trim?.()),
            messageId: trainingSummaryResult?.messageId ?? null,
          });

          setInitialChatMessages((prev) =>
            appendDeferredRemindMessage(prev, trainingSummaryResult)
          );
        }

        setIsDeferredRemindActive(false);
        setBootPhaseWithLog("ready", "deferred_remind_complete");
        console.log("[chat/bootstrap] deferred remind ui released", {
          durationMs: Date.now() - startedAt,
        });

        const restoredMessages =
          (await chatAgent?.getBootstrapMessages?.()) ?? [];

        if (cancelled) return;
        console.log("[chat/bootstrap] deferred remind complete, refreshed messages:", restoredMessages.length, { durationMs: Date.now() - startedAt });
        setInitialChatMessages(restoredMessages);
        console.log("[chat/bootstrap] deferred remind restored messages", { count: restoredMessages.length });
      } catch (err) {
        console.warn("[useChatBootstrap] deferred remind failed:", err, { durationMs: Date.now() - startedAt });
        if (cancelled) return;
        console.log("[chat/bootstrap] deferred remind aborted, restoring ready state");
        setIsDeferredRemindActive(false);
        setBootPhaseWithLog("ready", "deferred_remind_failed");
      }
    }

    runDeferredRemind();

    return () => {
      cancelled = true;
    };
  }, [
    mode,
    chatModeValue,
    chatBootReady,
    chatAgent,
    appAgent,
  ]);

  const bootLoadingText = useMemo(() => {
    if (isDeferredRemindActive) {
      return "美树同学正在回想…";
    }

    if (chatBootReady) return "";

    if (shouldRotateLoadingHints) {
      return SUMMARIZING_HINTS[hintIndex] ?? SUMMARIZING_HINTS[0];
    }

    if (bootPhase === "error") {
      return "启动时出了点小问题…";
    }

    return "正在准备中…";
  }, [chatBootReady, bootPhase, hintIndex, shouldRotateLoadingHints, isDeferredRemindActive]);

  const chatShellReady = chatBootReady || isDeferredRemindActive;
  const chatInteractionReady = chatBootReady && !isDeferredRemindActive;
  const hideStageModel = isSummarizingPhase && !chatShellReady;
  return {
    chatBootReady: chatInteractionReady,
    chatShellReady,
    initialChatMessages,
    bootPhase,
    bootLoadingText,
    hideStageModel,
  };
}
