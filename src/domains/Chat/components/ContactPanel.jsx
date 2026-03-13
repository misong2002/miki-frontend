import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

function formatTime(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export default function ContactPanel({ messages = [] }) {
  const historyRef = useRef(null);

  useEffect(() => {
    const el = historyRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  return (
    <div className="contact-shell">
      <div className="contact-header">
        <div className="contact-title">美樹さん的联络信息</div>
        <div className="contact-subtitle">Sayaka communication channel</div>
      </div>

      <div className="contact-history" ref={historyRef}>
        {messages.map((msg, index) => {
          const showMeta =
            index === 0 ||
            Math.abs(msg.createdAt - messages[index - 1].createdAt) > 60 * 1000;

          return (
            <div key={msg.id} className="contact-row">
              <div className="contact-message-group">
                {showMeta && (
                  <div className="contact-meta">
                    <span className="contact-name">美树沙耶香</span>
                    <span className="contact-time">{formatTime(msg.createdAt)}</span>
                    {msg.epoch != null && (
                      <span className="contact-epoch">epoch {msg.epoch}</span>
                    )}
                  </div>
                )}

                <div className="contact-bubble">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                  >
                    {msg.content}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}