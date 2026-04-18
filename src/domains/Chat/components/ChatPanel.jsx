// src/domains/Chat/components/ChatPanel.jsx
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

function makeMessage({
  id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  role = "assistant",
  content = "",
  createdAt = Date.now(),
  status = "done",
  references = [],
  meta = {},
  ...rest
}) {
  return {
    id,
    role,
    content,
    createdAt,
    status,
    references,
    meta,
    ...rest,
  };
}

function normalizeInitialMessage(msg) {
  const interrupted = msg?.meta?.interrupted ?? false;
  const hasError = Boolean(msg?.meta?.error);

  let status = msg?.status ?? "done";
  if (hasError) status = "error";
  else if (!msg?.status) status = "done";

  return makeMessage({
    ...msg,
    status,
    meta: {
      ...(msg?.meta ?? {}),
      interrupted,
    },
  });
}

function buildFallbackMessages({ suppressFallbackGreeting = false } = {}) {
  if (suppressFallbackGreeting) {
    return [];
  }

  return [
    makeMessage({
      role: "assistant",
      content:
        "久等了！这里是正义的魔法少女——美树沙耶香！快开始今天的魔女狩猎吧！",
      status: "done",
    }),
  ];
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();

  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");

  if (sameDay) {
    return `${hh}:${mm}`;
  }

  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${month}-${day} ${hh}:${mm}`;
}

export default function ChatPanel({
  disabled = false,
  chatAgent,
  bootLoadingText = "美樹さん正在回想……",
  initialMessages = [],
  bootLoading = false,
  suppressFallbackGreeting = false,
  interactionRequest = null,
  onInteractionRequestHandled = null,
}) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const [messages, setMessages] = useState(() => {
    if (Array.isArray(initialMessages) && initialMessages.length > 0) {
      return initialMessages.map(normalizeInitialMessage);
    }

    return buildFallbackMessages({ suppressFallbackGreeting });
  });

  const historyRef = useRef(null);
  const textareaRef = useRef(null);
  const scrollStateRef = useRef({
    autoFollow: false,
    lastMessageCount: messages.length,
    lastScrollHeight: 0,
    programmatic: false,
    releaseTimer: null,
  });

  function setProgrammaticScrollTop(top) {
    const el = historyRef.current;
    if (!el) return;

    const state = scrollStateRef.current;
    state.programmatic = true;
    el.scrollTop = top;

    if (state.releaseTimer) {
      window.clearTimeout(state.releaseTimer);
    }

    state.releaseTimer = window.setTimeout(() => {
      state.programmatic = false;
      state.releaseTimer = null;
    }, 80);
  }

  function disableAutoFollowFromUserScroll(event) {
    const el = historyRef.current;
    const state = scrollStateRef.current;

    if (state.programmatic && event?.type === "scroll") return;

    if (state.releaseTimer) {
      window.clearTimeout(state.releaseTimer);
      state.releaseTimer = null;
    }

    state.programmatic = false;
    state.autoFollow = false;
    if (el) {
      state.lastScrollHeight = el.scrollHeight;
    }
  }

  function handleHistoryPointerDown(event) {
    const el = historyRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const scrollbarWidth = Math.max(12, el.offsetWidth - el.clientWidth);
    if (event.clientX >= rect.right - scrollbarWidth - 2) {
      disableAutoFollowFromUserScroll(event);
    }
  }

  useLayoutEffect(() => {
    const el = historyRef.current;
    if (!el) return;

    const state = scrollStateRef.current;
    const nextScrollHeight = el.scrollHeight;
    const messageCountDelta = messages.length - state.lastMessageCount;
    const scrollHeightDelta = nextScrollHeight - state.lastScrollHeight;

    if (bootLoading) {
      state.lastMessageCount = messages.length;
      state.lastScrollHeight = nextScrollHeight;
      return;
    }

    if (state.autoFollow && messageCountDelta > 0) {
      setProgrammaticScrollTop(
        Math.max(0, nextScrollHeight - el.clientHeight)
      );
    } else if (state.autoFollow && scrollHeightDelta > 0) {
      setProgrammaticScrollTop(
        Math.min(
          Math.max(0, nextScrollHeight - el.clientHeight),
          el.scrollTop + scrollHeightDelta / 2
        )
      );
    }

    state.lastMessageCount = messages.length;
    state.lastScrollHeight = nextScrollHeight;
  }, [messages, bootLoading]);

  useEffect(() => {
    return () => {
      const timer = scrollStateRef.current.releaseTimer;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  useEffect(() => {
    if (bootLoading) return;

    if (Array.isArray(initialMessages) && initialMessages.length > 0) {
      setMessages(initialMessages.map(normalizeInitialMessage));
      return;
    }

    setMessages(buildFallbackMessages({ suppressFallbackGreeting }));
  }, [initialMessages, bootLoading, suppressFallbackGreeting]);

  function resetTextareaHeight() {
    const el = textareaRef.current;
    if (!el) return;

    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }

  useEffect(() => {
    if (bootLoading) return;
    resetTextareaHeight();
  }, [input, bootLoading]);

  function updateAssistantMessage(messageId, content, status = "pending") {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId
          ? {
              ...msg,
              content,
              status,
            }
          : msg
      )
    );
  }

  async function sendMessage({
    text,
    messageType = "user",
    clearInput = false,
  }) {
    const trimmed = String(text ?? "").trim();
    if (
      !trimmed ||
      sending ||
      disabled ||
      bootLoading ||
      !chatAgent?.sendUserMessage
    ) {
      return false;
    }

    const userMessage = makeMessage({
      role: "user",
      content: trimmed,
      status: "done",
      meta: {
        messageType,
      },
    });

    const pendingAssistant = makeMessage({
      role: "assistant",
      content: "正在思考……",
      status: "pending",
    });

    scrollStateRef.current.autoFollow = true;
    setMessages((prev) => [...prev, userMessage, pendingAssistant]);
    if (clearInput) setInput("");
    setSending(true);

    try {
      await chatAgent.sendUserMessage(
        {
          text: trimmed,
          messageId: pendingAssistant.id,
          messageType,
        },
        {
          onThinkingStart: () => {
            updateAssistantMessage(
              pendingAssistant.id,
              "正在思考……",
              "pending"
            );
          },

          onTextUpdate: (fullText) => {
            updateAssistantMessage(
              pendingAssistant.id,
              fullText || "正在思考……",
              "pending"
            );
          },

          onDone: (finalText) => {
            updateAssistantMessage(
              pendingAssistant.id,
              finalText || "……",
              "done"
            );
          },

          onInterrupted: (partialText) => {
            updateAssistantMessage(
              pendingAssistant.id,
              (partialText || "……") +
                "\n\n[对话被中断]\n诶诶诶，怎么啦？你先说~",
              "done"
            );
          },

          onError: (err, partialText) => {
            updateAssistantMessage(
              pendingAssistant.id,
              partialText || `请求失败：${err?.message ?? "unknown error"}`,
              "error"
            );
          },
        }
      );
      return true;
    } catch (err) {
      updateAssistantMessage(
        pendingAssistant.id,
        `请求失败：${err?.message ?? "unknown error"}`,
        "error"
      );
      return false;
    } finally {
      setSending(false);
      textareaRef.current?.focus?.();
    }
  }

  async function handleSend() {
    await sendMessage({
      text: input,
      messageType: "user",
      clearInput: true,
    });
  }

  useEffect(() => {
    if (!interactionRequest?.id) return;

    sendMessage({
      text: interactionRequest.text,
      messageType: "interaction",
      clearInput: false,
    });
    onInteractionRequestHandled?.(interactionRequest.id);
  }, [interactionRequest?.id]);

  function handleInterrupt() {
    if (bootLoading) return;
    chatAgent?.interrupt?.();
  }

  function handleKeyDown(event) {
    if (bootLoading) return;

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  useEffect(() => {
    return () => {
      chatAgent?.interrupt?.();
    };
  }, [chatAgent]);

  return (
    <div className="chat-shell">
      <div className="chat-header">
        <div className="chat-title">Talk with 美樹さん！</div>
        <div className="chat-subtitle">
          （Ask her questions about physics and machine learning）
        </div>
      </div>

      <div
        className="chat-history"
        ref={historyRef}
        onPointerDown={handleHistoryPointerDown}
        onScroll={disableAutoFollowFromUserScroll}
        onTouchMove={disableAutoFollowFromUserScroll}
        onWheel={disableAutoFollowFromUserScroll}
      >
        {bootLoading ? (
          <div className="chat-boot-state">
            <div className="chat-boot-state-inner">
              <div className="chat-boot-title">{bootLoadingText}</div>
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, index) => {
              const prev = messages[index - 1];

              const showMeta =
                index === 0 ||
                prev?.role !== msg.role ||
                Math.abs((msg.createdAt ?? 0) - (prev?.createdAt ?? 0)) >
                  5 * 60 * 1000;

              return (
                <div key={msg.id} className={`chat-row ${msg.role}`}>
                  <div className="chat-message-group">
                    {showMeta && (
                      <div className={`chat-meta ${msg.role}`}>
                        <span className="chat-name">
                          {msg.role === "user" ? "你" : "美树沙耶香"}
                        </span>
                        <span className="chat-time">
                          {formatTime(msg.createdAt)}
                        </span>
                      </div>
                    )}

                    <div
                      className={`chat-bubble ${msg.role} ${msg.status || "done"}`}
                    >
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                      >
                        {msg.content ||
                          (msg.status === "pending" ? "正在回想……" : "")}
                      </ReactMarkdown>
                    </div>

                    {Array.isArray(msg.references) && msg.references.length > 0 && (
                      <div className="chat-references">
                        {msg.references.map((ref, i) => (
                          <span
                            className="chat-ref-chip"
                            key={`${msg.id}-ref-${i}`}
                          >
                            {ref.title || ref.source || "reference"}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      <div className="chat-input-bar">
        {bootLoading ? (
          <div className="chat-input-loading">
            <div className="chat-textarea loading" />
            <div className="chat-actions">
              <button className="chat-send-btn" disabled>
                Send
              </button>
              <button className="chat-interrupt-btn" disabled>
                Interrupt
              </button>
            </div>
          </div>
        ) : (
          <>
            <textarea
              ref={textareaRef}
              className="chat-textarea"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter message, Enter to send, Shift+Enter for new line"
              disabled={disabled || sending}
              rows={1}
            />

            <div className="chat-actions">
              <button
                className="chat-send-btn"
                onClick={handleSend}
                disabled={disabled || sending || !input.trim()}
              >
                {sending ? "Sending..." : "Send"}
              </button>

              <button
                className="chat-interrupt-btn"
                onClick={handleInterrupt}
                disabled={!sending}
              >
                Interrupt
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
