import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

function makeMessage({
  role,
  content,
  status = "done",
  emotion = null,
  references = [],
}) {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    status,
    emotion,
    references,
    createdAt: Date.now(),
  };
}

function formatTime(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export default function ChatPanel({ disabled, agent }) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState([
    makeMessage({
      role: "assistant",
      content:
        "久等了！这里是正义的魔法少女——美树沙耶香！快开始今天的魔女狩猎吧！",
    }),
  ]);

  const historyRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    const el = historyRef.current;
    if (!el) return;

    el.scrollTo({
      top: el.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  function resetTextareaHeight() {
    const el = textareaRef.current;
    if (!el) return;

    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }

  useEffect(() => {
    resetTextareaHeight();
  }, [input]);

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
    if (!text || sending || disabled || !agent?.hear) return;

    const userMessage = makeMessage({
      role: "user",
      content: text,
    });

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
              partialText || `请求失败：${err.message}`,
              "error"
            );
          },
        }
      );
    } catch (err) {
      updateAssistantMessage(
        pendingAssistant.id,
        `请求失败：${err.message}`,
        "error"
      );
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  function handleInterrupt() {
    agent?.interrupt?.();
  }

  function handleKeyDown(event) {
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
        {messages.map((msg, index) => {
          const showMeta =
            index === 0 ||
            messages[index - 1].role !== msg.role ||
            Math.abs(msg.createdAt - messages[index - 1].createdAt) >
              5 * 60 * 1000;

          return (
            <div key={msg.id} className={`chat-row ${msg.role}`}>
              <div className="chat-message-group">
                {showMeta && (
                  <div className={`chat-meta ${msg.role}`}>
                    <span className="chat-name">
                      {msg.role === "user" ? "你" : "美树沙耶香"}
                    </span>
                    <span className="chat-time">{formatTime(msg.createdAt)}</span>
                  </div>
                )}

                <div className={`chat-bubble ${msg.role} ${msg.status}`}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                  >
                    {msg.content || (msg.status === "pending" ? "正在思考……" : "")}
                  </ReactMarkdown>
                </div>

                {msg.references && msg.references.length > 0 && (
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
        })}
      </div>

      <div className="chat-input-bar">
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
      </div>
    </div>
  );
}