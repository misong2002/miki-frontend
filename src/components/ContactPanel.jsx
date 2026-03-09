export default function ContactPanel({ messages }) {
  return (
    <div className="contact-shell">
      <div className="contact-header">
        <div className="contact-title">美樹さん的联络信息</div>
        <div className="contact-subtitle">Sayaka communication channel</div>
      </div>

      <div className="contact-history">
        {messages.map((msg, index) => (
          <div key={index} className="contact-row">
            <div className="contact-bubble">{msg}</div>
          </div>
        ))}
      </div>
    </div>
  );
}