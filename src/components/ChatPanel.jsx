import { useEffect, useRef, useState } from "react";
import { sendChatStream } from "../services/chatService";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { emotionEngine } from "../live2d/emotionEngine";

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

/**
 * 全程增量控制符状态机
 *
 * 识别：
 *   <emotion:happy>
 *   <motion:001>
 *
 * 设计原则：
 * 1. 按字符流式处理，可跨 chunk 保持状态
 * 2. 只有完整闭合且合法的标签才触发控制事件
 * 3. 半截标签先缓存，不显示
 * 4. 非法标签/普通尖括号内容按正文输出
 */
function createControlStreamParser() {
  return {
    state: "TEXT", // TEXT | TAG
    tagBuffer: "",

    /**
     * 输入一段新文本，输出：
     * - text: 可以安全显示的正文
     * - events: 解析出的控制事件
     */
    push(chunk) {
      let text = "";
      const events = [];

      for (let i = 0; i < chunk.length; i += 1) {
        const ch = chunk[i];

        if (this.state === "TEXT") {
          if (ch === "<") {
            this.state = "TAG";
            this.tagBuffer = "<";
          } else {
            text += ch;
          }
          continue;
        }

        // TAG 状态
        this.tagBuffer += ch;

        // 完整闭合
        if (ch === ">") {
          const tag = this.tagBuffer;
          const emotionMatch = tag.match(/^<emotion:([a-zA-Z0-9_-]+)>$/);
          const motionMatch = tag.match(/^<motion:([a-zA-Z0-9_-]+)>$/);

          if (emotionMatch) {
            events.push({ type: "emotion", value: emotionMatch[1] });
          } else if (motionMatch) {
            events.push({ type: "motion", value: motionMatch[1] });
          } else {
            // 非法/未知标签，按正文原样输出
            text += tag;
          }

          this.state = "TEXT";
          this.tagBuffer = "";
          continue;
        }

        // 如果 tag 太长还没闭合，基本可以判定不是控制符，回退成正文
        if (this.tagBuffer.length > 64) {
          text += this.tagBuffer;
          this.state = "TEXT";
          this.tagBuffer = "";
        }
      }

      return { text, events };
    },

    /**
     * 流结束时把残留内容刷出来
     * - 半截 tag 不再等待，直接按正文输出
     */
    flush() {
      let text = "";
      if (this.state === "TAG" && this.tagBuffer) {
        text = this.tagBuffer;
      }

      this.state = "TEXT";
      this.tagBuffer = "";

      return { text, events: [] };
    },

    reset() {
      this.state = "TEXT";
      this.tagBuffer = "";
    },
  };
}

export default function ChatPanel({ disabled }) {
  const startedSpeakingRef = useRef(false);

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
  const abortControllerRef = useRef(null);

  const activeMessageIdRef = useRef(null);
  const networkBufferRef = useRef("");
  const displayQueueRef = useRef("");
  const displayedTextRef = useRef("");
  const streamFinishedRef = useRef(false);

  const transferTimerRef = useRef(null);
  const typewriterTimerRef = useRef(null);

  // 新增：全程增量 parser
  const controlParserRef = useRef(createControlStreamParser());

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

  function stopAllTimers() {
    if (transferTimerRef.current) {
      clearInterval(transferTimerRef.current);
      transferTimerRef.current = null;
    }
    if (typewriterTimerRef.current) {
      clearInterval(typewriterTimerRef.current);
      typewriterTimerRef.current = null;
    }
  }

  function resetStreamState() {
    networkBufferRef.current = "";
    displayQueueRef.current = "";
    displayedTextRef.current = "";
    streamFinishedRef.current = false;
    activeMessageIdRef.current = null;
    controlParserRef.current.reset();
  }

  function dispatchControlEvents(events) {
    for (const event of events) {
      if (event.type === "emotion") {
        emotionEngine.requestEmotion(event.value, { source: "llm" });
      } else if (event.type === "motion") {
        emotionEngine.requestMotion(event.value, { source: "llm" });
      }
    }
  }

  function handleIncomingToken(token) {
    if (!token) return;

    const parsed = controlParserRef.current.push(token);

    if (parsed.events.length > 0) {
      dispatchControlEvents(parsed.events);
    }

    if (parsed.text) {
      networkBufferRef.current += parsed.text;
    }
  }

  function flushParserRemainder() {
    const parsed = controlParserRef.current.flush();

    if (parsed.events.length > 0) {
      dispatchControlEvents(parsed.events);
    }

    if (parsed.text) {
      networkBufferRef.current += parsed.text;
    }
  }

  function startTransferLoop() {
    if (transferTimerRef.current) return;

    transferTimerRef.current = setInterval(() => {
      const chunk = networkBufferRef.current;
      if (!chunk) return;

      displayQueueRef.current += chunk;
      networkBufferRef.current = "";
    }, 180);
  }

  function getCharsPerTick(queue) {
    if (!queue) return 0;
    if (queue.length > 120) return 8;
    if (queue.length > 60) return 6;
    if (queue.length > 24) return 4;
    return 2;
  }

  function takeNaturalChunk(queue) {
    if (!queue) return "";

    const punctuationRegex = /[，。！？；：\n]/;
    const charsPerTick = getCharsPerTick(queue);
    const searchWindow = queue.slice(0, Math.min(queue.length, 12));
    const punctuationIndex = searchWindow.search(punctuationRegex);

    if (punctuationIndex !== -1) {
      return queue.slice(0, punctuationIndex + 1);
    }

    return queue.slice(0, charsPerTick);
  }

  function startTypewriterLoop() {
    if (typewriterTimerRef.current) return;

    typewriterTimerRef.current = setInterval(() => {
      const messageId = activeMessageIdRef.current;
      if (!messageId) return;

      const queue = displayQueueRef.current;

      if (!queue) {
        if (
          streamFinishedRef.current &&
          !networkBufferRef.current &&
          !displayQueueRef.current
        ) {
          updateAssistantMessage(
            messageId,
            displayedTextRef.current || "……咦，我刚刚一下子卡住了。",
            "done"
          );
          stopAllTimers();
        }
        return;
      }

      const chunk = takeNaturalChunk(queue);
      if (!chunk) return;

      displayQueueRef.current = queue.slice(chunk.length);
      displayedTextRef.current += chunk;

      updateAssistantMessage(
        messageId,
        displayedTextRef.current || "正在思考……",
        "pending"
      );
    }, 120);
  }

  function interruptAssistant() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      emotionEngine.interrupt();
    }

    stopAllTimers();
    streamFinishedRef.current = true;

    flushParserRemainder();

    if (networkBufferRef.current) {
      displayQueueRef.current += networkBufferRef.current;
      networkBufferRef.current = "";
    }

    if (displayQueueRef.current) {
      displayedTextRef.current += displayQueueRef.current;
      displayQueueRef.current = "";
    }

    const messageId = activeMessageIdRef.current;
    if (messageId) {
      updateAssistantMessage(
        messageId,
        (displayedTextRef.current || "……") +
          "\n\n[对话被中断]\n诶诶诶，怎么啦？你先说~",
        "done"
      );
    }

    setSending(false);
    activeMessageIdRef.current = null;
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || sending || disabled) return;

    const userMessage = makeMessage({
      role: "user",
      content: text,
    });

    const pendingAssistant = makeMessage({
      role: "assistant",
      content: "正在思考……",
      status: "pending",
    });

    stopAllTimers();
    resetStreamState();

    activeMessageIdRef.current = pendingAssistant.id;

    setMessages((prev) => [...prev, userMessage, pendingAssistant]);
    setInput("");
    setSending(true);

    startTransferLoop();
    startTypewriterLoop();

    abortControllerRef.current = new AbortController();
    emotionEngine.notifyUserActivity();
    emotionEngine.setTypingState("thinking");
    startedSpeakingRef.current = false;

    try {
      await sendChatStream(
        text,
        (token) => {
          handleIncomingToken(token);
        },
        abortControllerRef.current.signal
      );

      flushParserRemainder();
      streamFinishedRef.current = true;
    } catch (err) {
      if (err?.name === "AbortError") {
        return;
      }

      flushParserRemainder();

      if (networkBufferRef.current) {
        displayQueueRef.current += networkBufferRef.current;
        networkBufferRef.current = "";
      }

      streamFinishedRef.current = true;

      const suffix =
        displayedTextRef.current || displayQueueRef.current
          ? `\n\n[流式中断：${err.message}]`
          : `请求失败：${err.message}`;

      displayQueueRef.current += suffix;

      const messageId = pendingAssistant.id;

      const failWatcher = setInterval(() => {
        const empty = !networkBufferRef.current && !displayQueueRef.current;

        if (empty) {
          clearInterval(failWatcher);
          updateAssistantMessage(
            messageId,
            displayedTextRef.current || `请求失败：${err.message}`,
            "error"
          );
          stopAllTimers();
        }
      }, 50);
    } finally {
      abortControllerRef.current = null;
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      stopAllTimers();
    };
  }, []);

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
            onClick={interruptAssistant}
            disabled={!sending}
          >
            打断
          </button>
        </div>
      </div>
    </div>
  );
}