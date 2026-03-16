import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

/**
 * 统一构造消息对象。
 * - 如果是从 memory 恢复的消息，尽量保留原有 id / createdAt / meta
 * - 如果是新消息，就自动补默认字段
 */
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

/**
 * 把外部传入的历史消息标准化。
 * 目标：
 * - memory 里恢复出来的消息通常没有 status
 * - UI 层默认应把历史消息视为 done
 * - interrupted / error 这些临时态要尽量从 meta 里还原
 */
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
  disabled,
  agent,
  initialMessages = [],
  bootLoading = false,
}) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const [messages, setMessages] = useState(() => {
    if (Array.isArray(initialMessages) && initialMessages.length > 0) {
      return initialMessages.map(normalizeInitialMessage);
    }

    return [
      makeMessage({
        role: "assistant",
        content:
          "久等了！这里是正义的魔法少女——美树沙耶香！快开始今天的魔女狩猎吧！",
        status: "done",
      }),
    ];
  });

  const historyRef = useRef(null);
  const textareaRef = useRef(null);

  /**
   * boot 完成后，把 App 传进来的 initialMessages 正确同步到本地 state。
   * 这样启动时异步写进 memory 的 greeting 才能显示出来。
   */
  useEffect(() => {
    if (bootLoading) return;

    if (Array.isArray(initialMessages) && initialMessages.length > 0) {
      setMessages(initialMessages.map(normalizeInitialMessage));
    }
  }, [initialMessages, bootLoading]);

  /**
   * 消息变化后自动滚动到底部。
   */
  useEffect(() => {
    if (bootLoading) return;

    const el = historyRef.current;
    if (!el) return;

    el.scrollTo({
      top: el.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, bootLoading]);

  /**
   * 输入框高度自动适配。
   */
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

  /**
   * 更新 assistant 占位消息。
   */
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

  async function handleSend() {
    const text = input.trim();
    if (!text || sending || disabled || bootLoading || !agent?.hear) return;

    const userMessage = makeMessage({
      role: "user",
      content: text,
      status: "done",
    });

    /**
     * assistant 占位消息的 id 同时作为 messageId 传给 agent。
     * 这样 streaming 更新和 memory 里的对应关系更清楚。
     */
    const pendingAssistant = makeMessage({
      role: "assistant",
      content: "正在思考……",
      status: "pending",
    });

    setMessages((prev) => [...prev, userMessage, pendingAssistant]);
    setInput("");
    setSending(true);

    try {
      await agent.hear(
        {
          text,
          messageId: pendingAssistant.id,
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
    } catch (err) {
      updateAssistantMessage(
        pendingAssistant.id,
        `请求失败：${err?.message ?? "unknown error"}`,
        "error"
      );
    } finally {
      setSending(false);
      textareaRef.current?.focus?.();
    }
  }

  function handleInterrupt() {
    if (bootLoading) return;
    agent?.interrupt?.();
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
      agent?.interrupt?.();
    };
  }, [agent]);

  return (
    <div className="chat-shell">
      <div className="chat-header">
        <div className="chat-title">和美樹さん面对面！</div>
        <div className="chat-subtitle">
          （和她交流一下与原子核魔女战斗的情报吧）
        </div>
      </div>

      <div className="chat-history" ref={historyRef}>
        {bootLoading ? (
          <div className="chat-boot-state">
            <div className="chat-boot-state-inner">
              <div className="chat-boot-title">正在恢复对话记忆……</div>
              <div className="chat-boot-subtitle">
                美樹さん正在整理刚才的对话内容
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg, index) => {
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

                  <div className={`chat-bubble ${msg.role} ${msg.status || "done"}`}>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                    >
                      {msg.content || (msg.status === "pending" ? "正在思考……" : "")}
                    </ReactMarkdown>
                  </div>

                  {Array.isArray(msg.references) && msg.references.length > 0 && (
                    <div className="chat-references">
                      {msg.references.map((ref, i) => (
                        <span className="chat-ref-chip" key={`${msg.id}-ref-${i}`}>
                          {ref.title || ref.source || "reference"}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="chat-input-bar">
        {bootLoading ? (
          <div className="chat-input-loading">
            <div className="chat-textarea loading" />
            <div className="chat-actions">
              <button className="chat-send-btn" disabled>
                发送
              </button>
              <button className="chat-interrupt-btn" disabled>
                打断
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
              placeholder="输入消息，Enter 发送，Shift+Enter 换行"
              disabled={disabled || sending}
              rows={1}
            />

            <div className="chat-actions">
              <button
                className="chat-send-btn"
                onClick={handleSend}
                disabled={disabled || sending || !input.trim()}
              >
                {sending ? "发送中..." : "发送"}
              </button>

              <button
                className="chat-interrupt-btn"
                onClick={handleInterrupt}
                disabled={!sending}
              >
                打断
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}