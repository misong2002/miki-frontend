export default function TransitionOverlay({ visible }) {
  return <div className={`transition-overlay ${visible ? "visible" : ""}`} />;
}