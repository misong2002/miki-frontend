// src/hooks/useChatBootstrap.js
import { useEffect, useState } from "react";

export function useChatBootstrap({
  chatAgent,
  appAgent,
  mode,
  chatModeValue,
}) {
  const [chatBootReady, setChatBootReady] = useState(false);
  const [initialChatMessages, setInitialChatMessages] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapChat() {
      /**
       * 关键修正：
       * - 只有当前真正处于聊天模式时，才执行 chat bootstrap
       * - 避免 battle 恢复场景下先误跑 appAgent.start() / chat restore
       */
      if (mode !== chatModeValue) {
        return;
      }

      setChatBootReady(false);

      try {
        await appAgent?.start?.();

        const restoredMessages =
          (await chatAgent?.getBootstrapMessages?.()) ?? [];

        if (cancelled) return;
        setInitialChatMessages(restoredMessages);
      } catch (err) {
        console.warn("[useChatBootstrap] bootstrapChat failed:", err);

        if (cancelled) return;
        setInitialChatMessages([]);
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

    async function refreshWhenBackToChat() {
      /**
       * 只有：
       * - 当前已经回到聊天模式
       * - 并且首轮 chat bootstrap 已经完成
       * 才刷新聊天消息
       */
      if (mode !== chatModeValue || !chatBootReady) return;

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
  }, [mode, chatBootReady, chatModeValue, chatAgent]);

  return {
    chatBootReady,
    initialChatMessages,
  };
}