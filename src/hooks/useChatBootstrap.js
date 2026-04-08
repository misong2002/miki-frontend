// src/hooks/useChatBootstrap.js
import { useEffect, useMemo, useState } from "react";

const SUMMARIZING_HINTS = [
  "正在收拾房间……",
  "正在净化灵魂宝石……",
  "正在殴打白色孽畜……",
  "正在泡茶……",
  "正在指挥交响乐团……",
  '正在被圆环之理救赎……',
];

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
  const isSummarizingPhase =
      bootPhase === "archiving" || bootPhase === "compacting";
  /**
   * 在“摘要/整理”阶段轮播提示语
   */
  useEffect(() => {


    if (!isSummarizingPhase) return;

    const timer = window.setInterval(() => {
      setHintIndex((prev) => (prev + 1) % SUMMARIZING_HINTS.length);
    }, 1600);

    return () => {
      window.clearInterval(timer);
    };
  }, [bootPhase]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapChat() {
      /**
       * 关键约束：
       * - 只有当前真正处于聊天模式时，才执行 chat bootstrap
       * - 避免 battle 恢复场景下误跑 appAgent.start() / chat restore
       */
      if (mode !== chatModeValue) {
        return;
      }

      setChatBootReady(false);
      setBootPhase("archiving");
      setHintIndex(0);

      try {
        /**
         * 先启动 app agent。
         * 这里约定 appAgent.start 可接收一个 handlers 对象：
         * {
         *   onBootPhaseChange: ({ phase }) => {}
         * }
         *
         * 如果旧版 start 不接这个参数，也不会有问题。
         */
        await appAgent?.start?.({
          deferRemind: true,
          onBootPhaseChange: ({ phase } = {}) => {
            if (cancelled) return;
            if (!phase) return;
            setBootPhase(phase);
          },
        });

        /**
         * start 完成后，再恢复 chat 消息。
         * 这样能保证 remind 后落盘/恢复状态更一致。
         */
        const restoredMessages =
          (await chatAgent?.getBootstrapMessages?.()) ?? [];

        if (cancelled) return;
        setInitialChatMessages(restoredMessages);
        setBootPhase("ready");
        setHasDeferredRemindRun(false);
      } catch (err) {
        console.warn("[useChatBootstrap] bootstrapChat failed:", err);

        if (cancelled) return;
        setInitialChatMessages([]);
        setBootPhase("error");
      } finally {
        if (cancelled) return;
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
      if (mode !== chatModeValue) return;
      if (!chatBootReady) return;
      if (bootPhase !== "ready") return;
      if (hasDeferredRemindRun) return;
      if (!chatAgent?.remind) return;

      setHasDeferredRemindRun(true);
      setBootPhase("reminding");

      try {
        const remindResult = await chatAgent.remind();

        if (cancelled) return;

        setInitialChatMessages((prev) =>
          appendDeferredRemindMessage(prev, remindResult)
        );

        const restoredMessages =
          (await chatAgent?.getBootstrapMessages?.()) ?? [];

        if (cancelled) return;
        setInitialChatMessages(restoredMessages);
        setBootPhase("ready");
      } catch (err) {
        console.warn("[useChatBootstrap] deferred remind failed:", err);
        if (cancelled) return;
        setBootPhase("ready");
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
  ]);

  useEffect(() => {
    let cancelled = false;

    async function refreshWhenBackToChat() {
      /**
       * 只有：
       * - 当前已经回到聊天模式
       * - 并且首轮 chat bootstrap 已经完成
       * 才刷新聊天消息
       */
      if (mode !== chatModeValue || !chatBootReady) return;
      if (!hasDeferredRemindRun) return;
      if (bootPhase !== "ready") return;

      try {
        const restoredMessages =
          (await chatAgent?.getBootstrapMessages?.()) ?? [];

        if (cancelled) return;
        setInitialChatMessages(restoredMessages);
      } catch (err) {
        console.warn("[useChatBootstrap] refreshWhenBackToChat failed:", err);
      }
    }

    refreshWhenBackToChat();

    return () => {
      cancelled = true;
    };
  }, [
    mode,
    chatBootReady,
    chatModeValue,
    chatAgent,
    hasDeferredRemindRun,
    bootPhase,
  ]);

  const bootLoadingText = useMemo(() => {
    if (bootPhase === "reminding") {
      return "美树同学正在回想…";
    }

    if (chatBootReady) return "";

    if (isSummarizingPhase) {
      return SUMMARIZING_HINTS[hintIndex] ?? SUMMARIZING_HINTS[0];
    }

    if (bootPhase === "error") {
      return "启动时出了点小问题…";
    }

    return "正在准备中…";
  }, [chatBootReady, bootPhase, hintIndex]);

  /**
   * 你的需求是：
   * - 摘要阶段不显示 Live2D
   * - remind 阶段再显示“美树同学正在回想”
   *
   * 所以这里只在 summarizing 隐藏模型。
   */
  const hideStageModel = isSummarizingPhase && !chatBootReady;
  const chatBootReadyForUI = chatBootReady && bootPhase !== "reminding";

  return {
    chatBootReady: chatBootReadyForUI,
    initialChatMessages,
    bootPhase,
    bootLoadingText,
    hideStageModel,
  };
}
