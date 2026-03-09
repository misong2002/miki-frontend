import { useState } from "react";
import { sendChat } from "../services/chatService";

export default function ChatPanel({ disabled }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "久等了！这里是正义的魔法少女——美树沙耶香！快开始今天的魔女巡逻吧！",
    },
  ]);
  const [loading, setLoading] = useState(false);

  async function handleSend() {
    const text = input.trim();
    if (!text || disabled || loading) return;

    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const result = await sendChat(text);
      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: result || "……咦，怎么没说话。",
        },
      ]);
    } catch (err) {
      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: `啊啊啊啊，抱歉抱歉，刚刚开小差了呢，诶嘿嘿~\n(${err.message})`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="chat-shell">
      <div className="chat-header">
        <div className="chat-title">和美樹さん面对面！</div>
        <div className="chat-subtitle">（和她交流一下与原子核魔女战斗的情报吧）</div>
      </div>

      <div className="chat-history">
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`chat-row ${msg.role === "user" ? "user" : "assistant"}`}
          >
            <div className="chat-bubble">{msg.content}</div>
          </div>
        ))}

        {loading && (
          <div className="chat-row assistant">
            <div className="chat-bubble typing">正在思考…</div>
          </div>
        )}
      </div>

      <div className="chat-input-bar">
        <textarea
          className="chat-textarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息，Enter 发送，Shift+Enter 换行"
          disabled={disabled || loading}
        />

        <div className="chat-actions">
          <button
            className="chat-send-btn"
            onClick={handleSend}
            disabled={disabled || loading}
          >
            {loading ? "发送中..." : "发送"}
          </button>
        </div>
      </div>
    </div>
  );
}