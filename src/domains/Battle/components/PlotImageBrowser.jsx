import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  fetchHistoryPlotImages,
  fetchLatestHistoryPlotImages,
} from "../services/historyToolService";

export default function PlotImageBrowser({
  title = "Plot Images",
  mode = "session",
  sessionId = "",
  defaultOpen = false,
  refreshKey = 0,
  overlayClassName = "",
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const files = useMemo(() => result?.files ?? [], [result]);
  const selectedFile = files[selectedIndex] ?? null;
  const selectedIsPdf = selectedFile?.name?.toLowerCase?.().endsWith(".pdf");
  const resolvedSessionId = result?.session_id || sessionId || "latest";
  const canLoad = mode === "latest" || Boolean(sessionId);

  async function loadImages() {
    if (!canLoad) {
      setResult(null);
      setSelectedIndex(0);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const nextResult =
        mode === "latest"
          ? await fetchLatestHistoryPlotImages()
          : await fetchHistoryPlotImages(sessionId);
      setResult(nextResult);
      setSelectedIndex(0);
    } catch (err) {
      setError(err.message || "failed to load plot images");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    loadImages();
  }, [open, mode, sessionId, refreshKey]);

  function selectPrev() {
    if (files.length <= 1) return;
    setSelectedIndex((prev) => (prev - 1 + files.length) % files.length);
  }

  function selectNext() {
    if (files.length <= 1) return;
    setSelectedIndex((prev) => (prev + 1) % files.length);
  }

  return (
    <div className={`plot-browser ${open ? "open" : "collapsed"}`}>
      <button
        className="plot-browser-toggle"
        type="button"
        onClick={() => setOpen((prev) => !prev)}
      >
        {open ? "Minimize" : `Open ${title}`}
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div className={["plot-browser-overlay", overlayClassName].filter(Boolean).join(" ")} role="dialog" aria-label={title}>
          <div className="plot-browser-panel">
            <div className="plot-browser-header">
              <div>
                <div className="plot-browser-title">{title}</div>
                <div className="plot-browser-subtitle">
                  session: {resolvedSessionId}
                </div>
              </div>
              <div className="plot-browser-header-actions">
                <button
                  className="plot-browser-small-btn"
                  type="button"
                  onClick={loadImages}
                  disabled={loading || !canLoad}
                >
                  {loading ? "loading..." : "refresh"}
                </button>
                <button
                  className="plot-browser-small-btn"
                  type="button"
                  onClick={() => setOpen(false)}
                >
                  minimize
                  
                </button>
              </div>
            </div>

          {error ? <div className="panel-error">{error}</div> : null}
          {!error && loading ? <div className="panel-status">loading plot images...</div> : null}
          {!error && !loading && !canLoad ? (
            <div className="panel-status">select a history session first</div>
          ) : null}
          {!error && !loading && canLoad && files.length === 0 ? (
            <div className="panel-status">no plot images found</div>
          ) : null}

          {!error && files.length > 0 && selectedFile ? (
            <>
              <div className="plot-browser-toolbar">
                <button
                  className="plot-browser-small-btn"
                  type="button"
                  onClick={selectPrev}
                  disabled={files.length <= 1}
                >
                  prev
                </button>
                <select
                  className="plot-browser-select"
                  value={selectedIndex}
                  onChange={(event) => setSelectedIndex(Number(event.target.value))}
                >
                  {files.map((file, index) => (
                    <option key={file.name} value={index}>
                      {file.name}
                    </option>
                  ))}
                </select>
                <button
                  className="plot-browser-small-btn"
                  type="button"
                  onClick={selectNext}
                  disabled={files.length <= 1}
                >
                  next
                </button>
              </div>

              <div className="plot-browser-stage">
                {selectedIsPdf ? (
                  <object
                    data={selectedFile.url}
                    type="application/pdf"
                    title={selectedFile.name}
                  >
                    <iframe src={selectedFile.url} title={selectedFile.name} />
                  </object>
                ) : (
                  <img src={selectedFile.url} alt={selectedFile.name} />
                )}
              </div>
              <div className="plot-browser-caption">
                {selectedIndex + 1}/{files.length} {selectedFile.name}
              </div>
            </>
          ) : null}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
