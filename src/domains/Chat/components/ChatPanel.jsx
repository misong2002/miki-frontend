// src/domains/Chat/components/ChatPanel.jsx
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { stripHiddenControlText } from "../../miki_san/language/controlTagParser";
import { prepareToolRoutedContext } from "../../miki_san/program/tool_router/toolRouterModule";

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
    content:
      msg?.role === "assistant"
        ? stripHiddenControlText(msg.content)
        : msg.content,
    status,
    references: msg?.references ?? msg?.meta?.references ?? [],
    meta: {
      ...(msg?.meta ?? {}),
      interrupted,
    },
  });
}

function buildRecentVisibleContext(messages = [], limit = 8) {
  return (Array.isArray(messages) ? messages : [])
    .filter((msg) => {
      if (!msg?.content?.trim()) return false;
      if (msg.status && msg.status !== "done") return false;
      return msg.role === "user" || msg.role === "assistant";
    })
    .slice(-limit)
    .map((msg) => ({
      role: msg.role,
      content:
        msg.role === "assistant"
          ? stripHiddenControlText(msg.content)
          : String(msg.content || "").trim(),
    }));
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

function normalizeToolStatus(status) {
  if (!status || typeof status !== "object") return null;
  const message = String(status.message || "").trim();
  if (!message) return null;
  return {
    ...status,
    tool: String(status.tool || "tool"),
    phase: status.phase || "running",
    message,
    at: status.at || Date.now(),
  };
}

function mergeToolStatusList(statuses = [], nextStatus) {
  const normalized = normalizeToolStatus(nextStatus);
  if (!normalized) return statuses;

  const existing = Array.isArray(statuses) ? statuses : [];
  const lastIndex = existing.length - 1;
  const last = lastIndex >= 0 ? existing[lastIndex] : null;
  const nextWithDuration = {
    ...normalized,
    durationMs:
      normalized.durationMs ??
      normalized.duration_ms ??
      (
        normalized.phase !== "running" &&
        last &&
        last.tool === normalized.tool &&
        Number.isFinite(last.at)
          ? Math.max(0, (normalized.at || Date.now()) - last.at)
          : null
      ),
  };

  if (
    last &&
    last.tool === nextWithDuration.tool &&
    last.phase === "running"
  ) {
    return [
      ...existing.slice(0, lastIndex),
      {
        ...last,
        ...nextWithDuration,
      },
    ];
  }

  return [...existing, nextWithDuration];
}

function getToolStatuses(meta = {}) {
  if (Array.isArray(meta.toolStatuses) && meta.toolStatuses.length > 0) {
    return meta.toolStatuses;
  }
  const single = normalizeToolStatus(meta.toolStatus);
  return single ? [single] : [];
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
  onTransformRequest = null,
  onStartTrainingRequest = null,
  onMoveRequest = null,
}) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState(null);

  const [messages, setMessages] = useState(() => {
    if (Array.isArray(initialMessages) && initialMessages.length > 0) {
      return initialMessages.map(normalizeInitialMessage);
    }

    return buildFallbackMessages({ suppressFallbackGreeting });
  });

  const historyRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const pendingInitialScrollRef = useRef(false);
  const scrollStateRef = useRef({
    autoFollow: false,
    lastMessageCount: messages.length,
    lastScrollHeight: 0,
    programmatic: false,
    releaseTimer: null,
  });

  function formatDuration(durationMs) {
    if (!Number.isFinite(durationMs) || durationMs < 0) return "";
    if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
    return `${(durationMs / 1000).toFixed(durationMs < 10000 ? 1 : 0)} s`;
  }

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

  function scrollHistoryToBottom() {
    const el = historyRef.current;
    if (!el) return;

    setProgrammaticScrollTop(Math.max(0, el.scrollHeight - el.clientHeight));
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

    if (pendingInitialScrollRef.current) {
      pendingInitialScrollRef.current = false;
      scrollHistoryToBottom();
      window.requestAnimationFrame(scrollHistoryToBottom);
    } else if (state.autoFollow && messageCountDelta > 0) {
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
      pendingInitialScrollRef.current = true;
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
    const visibleContent = stripHiddenControlText(content);
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId
          ? {
              ...msg,
              content: visibleContent,
              status,
            }
          : msg
      )
    );
  }

  function patchAssistantMessage(messageId, patch = {}) {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId
          ? {
              ...msg,
              ...patch,
              meta: {
                ...(msg.meta ?? {}),
                ...(patch.meta ?? {}),
              },
            }
          : msg
      )
    );
  }

  async function sendMessage({
    text,
    displayText: displayTextOverride = "",
    messageType = "user",
    clearInput = false,
    attachment: nextAttachment = null,
    renderUserMessage = true,
  }) {
    const trimmed = String(text ?? "").trim();
    const displayTextValue = String(displayTextOverride || trimmed).trim();
    const hasAttachment = Boolean(nextAttachment?.file);
    const displayText = displayTextValue || (hasAttachment ? "请阅读这个附件。" : "");
    if (
      !displayText ||
      sending ||
      disabled ||
      bootLoading ||
      !chatAgent?.sendUserMessage
    ) {
      return false;
    }

    const userMessage = makeMessage({
      role: "user",
      content: hasAttachment
        ? `${displayText}\n\n[附件：${nextAttachment.file.name}]`
        : displayText,
      status: "done",
      meta: {
        messageType,
        attachmentName: nextAttachment?.file?.name ?? null,
      },
    });

    const pendingAssistant = makeMessage({
      role: "assistant",
      content: "正在思考……",
      status: "pending",
    });

    scrollStateRef.current.autoFollow = true;
    setMessages((prev) =>
      renderUserMessage
        ? [...prev, userMessage, pendingAssistant]
        : [...prev, pendingAssistant]
    );
    if (clearInput) setInput("");
    if (nextAttachment) {
      setAttachment(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
    setSending(true);

    try {
      updateAssistantMessage(
        pendingAssistant.id,
        "正在思考……",
        "pending"
      );

      let visiblePrelude = "";
      const withPrelude = (text, fallback = "正在思考……") => {
        const body = text || fallback;
        return visiblePrelude ? `${visiblePrelude}\n\n${body}` : body;
      };

      const setToolStatus = (toolStatus) => {
        const normalized = normalizeToolStatus(toolStatus);
        if (!normalized) return;

        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== pendingAssistant.id) return msg;
            const toolStatuses = mergeToolStatusList(
              msg.meta?.toolStatuses ?? [],
              normalized
            );
            assistantMeta.toolStatuses = toolStatuses;
            return {
                ...msg,
                meta: {
                  ...(msg.meta ?? {}),
                  toolStatus: normalized,
                  toolStatuses,
                },
              };
          })
        );
      };
      const assistantMeta = {
        toolStatuses: [],
        references: [],
      };
      const mergeReferences = (nextReferences = []) => {
        if (!Array.isArray(nextReferences) || nextReferences.length === 0) return;

        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== pendingAssistant.id) return msg;
            const existing = Array.isArray(msg.references) ? msg.references : [];
            const merged = [...existing];
            const seen = new Set(
              existing.map((ref) => ref?.url || ref?.source || ref?.title).filter(Boolean)
            );

            for (const ref of nextReferences) {
              const key = ref?.url || ref?.source || ref?.title;
              if (!key || seen.has(key)) continue;
              seen.add(key);
              merged.push(ref);
            }

            assistantMeta.references = merged;
            return {
              ...msg,
              references: merged,
            };
          })
        );
      };

      const routedContext = await prepareToolRoutedContext({
        text: trimmed || displayText,
        attachment: nextAttachment,
        recentMessages: buildRecentVisibleContext(messages),
        onTransformRequest,
        onStartTrainingRequest,
        onMoveRequest,
        onToolStatus: setToolStatus,
        onPrelude: (prelude) => {
          visiblePrelude = prelude;
          updateAssistantMessage(pendingAssistant.id, prelude, "pending");
        },
      });

      const usedToolCount = routedContext.usedTools?.length ?? 0;

      if (Array.isArray(routedContext.references)) {
        patchAssistantMessage(pendingAssistant.id, {
          references: routedContext.references,
        });
        assistantMeta.references = routedContext.references;
      }

      if (usedToolCount) {
        setToolStatus({
          tool: "llm",
          phase: "running",
          message: "正在组织语言",
          at: Date.now(),
        });
      }

      await chatAgent.sendUserMessage(
        {
          text: routedContext.promptText,
          displayText,
          messageId: pendingAssistant.id,
          messageType,
          assistantMeta,
        },
        {
          onThinkingStart: () => {
            updateAssistantMessage(
              pendingAssistant.id,
              withPrelude("", "正在思考……"),
              "pending"
            );
          },

          onTextUpdate: (fullText) => {
            updateAssistantMessage(
              pendingAssistant.id,
              withPrelude(fullText, "正在思考……"),
              "pending"
            );
          },

          onDone: (finalText) => {
            updateAssistantMessage(
              pendingAssistant.id,
              withPrelude(finalText, "……"),
              "done"
            );
          },

          onInterrupted: (partialText) => {
            updateAssistantMessage(
              pendingAssistant.id,
              withPrelude(partialText, "……") +
                "\n\n[对话被中断]\n诶诶诶，怎么啦？你先说~",
              "done"
            );
          },

          onError: (err, partialText) => {
            updateAssistantMessage(
              pendingAssistant.id,
              withPrelude(
                partialText,
                `请求失败：${err?.message ?? "unknown error"}`
              ),
              "error"
            );
          },

          onToolStatus: setToolStatus,
          onReferences: mergeReferences,

          onControl: (event) => {
            if (event?.type === "config") {
              setToolStatus({
                tool: "program-config",
                phase: "running",
                message: `正在修改配置：${event.path}`,
                at: Date.now(),
              });
            }
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
      attachment,
    });
  }

  function handleAttachClick() {
    if (disabled || sending || bootLoading) return;
    fileInputRef.current?.click?.();
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0] ?? null;
    setAttachment(file ? { file } : null);
  }

  function clearAttachment() {
    setAttachment(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  useEffect(() => {
    if (!interactionRequest?.id) return;

    sendMessage({
      text: interactionRequest.text,
      displayText: interactionRequest.displayText,
      messageType: "interaction",
      clearInput: false,
      renderUserMessage: false,
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
                      {msg.role === "assistant" && getToolStatuses(msg.meta).length > 0 && (
                        <div className="chat-tool-status-list">
                          {getToolStatuses(msg.meta).map((status, index) => (
                            <div
                              key={`${status.tool}-${status.phase}-${status.at}-${index}`}
                              className={`chat-tool-status ${status.phase || "running"}`}
                            >
                              {status.message}
                              {status.phase !== "running" && formatDuration(status.durationMs) && (
                                <span className="chat-tool-status-duration">
                                  {formatDuration(status.durationMs)}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

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
                        {msg.references.map((ref, i) =>
                          ref.url || ref.source?.startsWith?.("http") ? (
                            <a
                              className="chat-ref-chip"
                              key={`${msg.id}-ref-${i}`}
                              href={ref.url || ref.source}
                              target="_blank"
                              rel="noreferrer"
                              title={ref.url || ref.source}
                            >
                              {ref.title || ref.source || "reference"}
                            </a>
                          ) : (
                            <span
                              className="chat-ref-chip"
                              key={`${msg.id}-ref-${i}`}
                              title={ref.source || ref.title || "reference"}
                            >
                              {ref.title || ref.source || "reference"}
                            </span>
                          )
                        )}
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

            {attachment?.file && (
              <div className="chat-attachment-chip">
                <span className="chat-attachment-name">
                  {attachment.file.name}
                </span>
                <button
                  className="chat-attachment-remove"
                  type="button"
                  onClick={clearAttachment}
                  disabled={sending}
                >
                  Remove
                </button>
              </div>
            )}

            <div className="chat-actions">
              <input
                ref={fileInputRef}
                className="chat-file-input"
                type="file"
                accept=".pdf,.docx,.txt,.md,.markdown,.tex,.csv,.json,.html,.htm,text/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={handleFileChange}
                disabled={disabled || sending}
              />

              <button
                className="chat-attach-btn"
                type="button"
                onClick={handleAttachClick}
                disabled={disabled || sending}
              >
                Attach
              </button>

              <button
                className="chat-send-btn"
                onClick={handleSend}
                disabled={disabled || sending || (!input.trim() && !attachment?.file)}
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
