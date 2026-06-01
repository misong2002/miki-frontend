import { useCallback, useEffect, useState } from "react";
import {
  fetchBenchmarkConfig,
  saveBenchmarkConfig,
  buildBenchmark,
} from "../services/benchmarkService";

// ── helpers ────────────────────────────────────────────────────────────────
function FeedbackSlot({ error, message, loadingText }) {
  const style = { minHeight: 22 };
  if (error) return <div style={style}><div className="panel-error">{error}</div></div>;
  if (loadingText) return <div style={style}><div className="panel-status">{loadingText}</div></div>;
  if (message) return <div style={style}><div className="panel-success">{message}</div></div>;
  return <div style={style} />;
}

// ── component ──────────────────────────────────────────────────────────────
export default function BenchmarkPanel({ onBenchmarkBuilt = null }) {
  // manifest fields
  const [manifest, setManifest] = useState({
    model_name: "SABER", topology: "leading_proton",
    dataset_type: "local", output_dir: "data/benchmarks/",
    splits: { train: 0.8, val: 0.1, test: 0.1, seed: 12345 },
    io_config: "config/benchmark_config/local_config.json",
    model_config: "config/benchmark_config/saber_config.json",
  });
  // resolved section data
  const [ioConfig, setIoConfig] = useState({});
  const [modelConfig, setModelConfig] = useState({});
  // status
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [buildStatus, setBuildStatus] = useState(null);

  // ── load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchBenchmarkConfig();
      if (result.config) setManifest((prev) => ({ ...prev, ...result.config }));
      if (result.io_config) setIoConfig(result.io_config);
      if (result.model_config) setModelConfig(result.model_config);
      if (result.build_status) setBuildStatus(result.build_status);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── save ─────────────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true);
    setError(""); setMessage("");
    try {
      await saveBenchmarkConfig({
        config: manifest, io_config: ioConfig, model_config: modelConfig,
      });
      setMessage("saved");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // ── build ────────────────────────────────────────────────────────────────
  async function handleBuild() {
    setBuilding(true);
    setError(""); setMessage("Building benchmark...");
    try {
      const result = await buildBenchmark();
      setMessage(`Build complete (${result.summary?.elapsed_seconds?.toFixed(0) ?? "?"}s)`);
      const refreshed = await fetchBenchmarkConfig();
      if (refreshed.build_status) setBuildStatus(refreshed.build_status);
      if (onBenchmarkBuilt && result.summary?.phase_c) {
        const pc = result.summary.phase_c;
        onBenchmarkBuilt({
          benchmark_path: pc.train?.path ?? "",
          val_benchmark_path: pc.val?.path ?? "",
          test_benchmark_path: pc.test?.path ?? "",
        });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBuilding(false);
    }
  }

  // ── field helpers ────────────────────────────────────────────────────────
  function updateManifest(key, value) {
    setManifest((prev) => ({ ...prev, [key]: value }));
  }
  function updateSplits(key, value) {
    setManifest((prev) => ({ ...prev, splits: { ...prev.splits, [key]: Number(value) } }));
  }
  function updateIoField(key, value) {
    setIoConfig((prev) => ({ ...prev, [key]: value }));
  }

  const BUSY = saving || building;
  const BENCH_TABS = ["manifest", "io", "model", "status"];
  const BENCH_TAB_LABELS = { manifest: "Manifest", io: "IO", model: "Model", status: "Build" };
  const [activeBenchTab, setActiveBenchTab] = useState("manifest");

  // dynamic flux/dataset slot count
  const [ioSlotCount, setIoSlotCount] = useState(() => {
    let n = 0;
    for (const k of Object.keys(ioConfig)) {
      const m = k.match(/^flux_file(\d+)$/);
      if (m) n = Math.max(n, parseInt(m[1], 10));
    }
    return Math.max(n, 1);
  });

  function addIoSlot() { setIoSlotCount((n) => n + 1); }
  function removeIoSlot(n) {
    if (ioSlotCount <= 1) return;
    // clear the removed slot
    setIoConfig((prev) => {
      const next = { ...prev };
      delete next[`flux_file${n}`];
      delete next[`dataset_${n}`];
      return next;
    });
    setIoSlotCount((c) => c - 1);
  }

  // compact the slot indices after removal
  useEffect(() => {
    // ensure slots are contiguous 1..ioSlotCount
  }, [ioSlotCount]);

  if (loading) return <div className="panel-status" style={{ padding: 20 }}>loading...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%", overflow: "hidden" }}>

      {/* sub-tab bar */}
      <div className="train-config-tabs" style={{ flex: "0 0 auto" }}>
        {BENCH_TABS.map((tid) => (
          <button
            key={tid}
            className={`train-config-tab ${activeBenchTab === tid ? "active" : ""}`}
            onClick={() => setActiveBenchTab(tid)}
          >
            {BENCH_TAB_LABELS[tid]}
          </button>
        ))}
      </div>

      {/* tab content — fills available space */}
      <div className="train-config-scroll" style={{ flex: 1, padding: "0 4px 0 0" }}>

        {/* ── manifest ───────────────────────────────────────────────── */}
        {activeBenchTab === "manifest" && (
          <div style={{ padding: 10 }}>
            <div className="train-config-item">
              <label className="train-config-label">model_name</label>
              <select className="train-config-input" value={manifest.model_name}
                onChange={(e) => updateManifest("model_name", e.target.value)} disabled={BUSY}>
                <option value="SABER">SABER</option>
                <option value="SAYACA">SAYACA</option>
                <option value="HMsiren">HMsiren</option>
              </select>
            </div>

            <div className="train-config-item">
              <label className="train-config-label">topology</label>
              <select className="train-config-input" value={manifest.topology}
                onChange={(e) => updateManifest("topology", e.target.value)} disabled={BUSY}>
                <option value="inclusive">inclusive</option>
                <option value="leading_proton">leading_proton</option>
              </select>
            </div>

            <div className="train-config-item">
              <label className="train-config-label">dataset_type</label>
              <select className="train-config-input" value={manifest.dataset_type}
                onChange={(e) => updateManifest("dataset_type", e.target.value)} disabled={BUSY}>
                <option value="local">local</option>
                <option value="doraemon">doraemon</option>
              </select>
            </div>

            <div className="train-config-item">
              <label className="train-config-label">output_dir</label>
              <input className="train-config-input" value={manifest.output_dir}
                onChange={(e) => updateManifest("output_dir", e.target.value)}
                placeholder="data/benchmarks/my_benchmark" disabled={BUSY} />
            </div>

            <div className="train-config-item" style={{ marginTop: 8 }}>
              <label className="train-config-label">io_config (section ref)</label>
              <input className="train-config-input" value={manifest.io_config}
                onChange={(e) => updateManifest("io_config", e.target.value)}
                placeholder="config/benchmark_config/local_config.json" disabled={BUSY} />
            </div>

            <div className="train-config-item">
              <label className="train-config-label">model_config (section ref)</label>
              <input className="train-config-input" value={manifest.model_config}
                onChange={(e) => updateManifest("model_config", e.target.value)}
                placeholder="config/benchmark_config/saber_config.json" disabled={BUSY} />
            </div>

            {/* splits */}
            <div style={{ marginTop: 10, padding: "8px 10px", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8 }}>
              <strong style={{ fontSize: "0.85rem" }}>splits</strong>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 6 }}>
                {["train", "val", "test"].map((k) => (
                  <div key={k} className="train-config-item">
                    <label className="train-config-label">{k}</label>
                    <input className="train-config-input" type="number" step="0.01" min="0" max="1"
                      value={manifest.splits?.[k] ?? ""}
                      onChange={(e) => updateSplits(k, e.target.value)} disabled={BUSY} />
                  </div>
                ))}
                <div className="train-config-item">
                  <label className="train-config-label">seed</label>
                  <input className="train-config-input" type="number"
                    value={manifest.splits?.seed ?? ""}
                    onChange={(e) => updateSplits("seed", e.target.value)} disabled={BUSY} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── io_config ────────────────────────────────────────────────── */}
        {activeBenchTab === "io" && (
          <div style={{ padding: 10 }}>
            <p style={{ fontSize: "0.75rem", opacity: 0.6, margin: "0 0 10px" }}>
              Section: {manifest.io_config}
              {" · "}
              <strong>{manifest.dataset_type === "doraemon" ? "Doraemon" : "Local"}</strong>
            </p>
            {Array.from({ length: ioSlotCount }, (_, i) => i + 1).map((n) => {
              const fluxKey = `flux_file${n}`;
              const dataKey = `dataset_${n}`;
              const isDoraemon = manifest.dataset_type === "doraemon";
              const dataVal = ioConfig[dataKey] ?? "";
              const dataObj = (isDoraemon && typeof dataVal === "object") ? dataVal : {};

              return (
                <div key={n} style={{
                  marginBottom: 10, padding: "8px 10px",
                  border: "1px solid rgba(255,255,255,0.10)", borderRadius: 8,
                  position: "relative",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--deep-blue)" }}>
                      Sample Set {n}
                    </span>
                    {ioSlotCount > 1 && (
                      <button className="train-config-btn"
                        onClick={() => removeIoSlot(n)}
                        disabled={BUSY}
                        style={{ padding: "4px 8px", fontSize: "0.75rem" }}>
                        ✕
                      </button>
                    )}
                  </div>

                  {!isDoraemon ? (
                    <>
                      <div className="train-config-item">
                        <label className="train-config-label">{fluxKey}</label>
                        <input className="train-config-input" value={ioConfig[fluxKey] ?? ""}
                          onChange={(e) => updateIoField(fluxKey, e.target.value)}
                          placeholder="flux JSON path" disabled={BUSY} />
                      </div>
                      <div className="train-config-item">
                        <label className="train-config-label">{dataKey}</label>
                        <input className="train-config-input"
                          value={typeof dataVal === "string" ? dataVal : ""}
                          onChange={(e) => updateIoField(dataKey, e.target.value)}
                          placeholder="HDF5 path or directory" disabled={BUSY} />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="train-config-item">
                        <label className="train-config-label">{fluxKey}</label>
                        <input className="train-config-input" value={ioConfig[fluxKey] ?? ""}
                          onChange={(e) => updateIoField(fluxKey, e.target.value)}
                          placeholder="flux JSON path or 'doraemon'" disabled={BUSY} />
                      </div>
                      <div className="train-config-item">
                        <label className="train-config-label">generator</label>
                        <input className="train-config-input"
                          value={dataObj.generator ?? "GiBUU"}
                          onChange={(e) => updateIoField(dataKey, { ...dataObj, generator: e.target.value })}
                          placeholder="GiBUU" disabled={BUSY} />
                      </div>
                      <div className="train-config-item">
                        <label className="train-config-label">oscillation</label>
                        <select className="train-config-input"
                          value={dataObj.oscillation ?? "unosc"}
                          onChange={(e) => updateIoField(dataKey, { ...dataObj, oscillation: e.target.value })}
                          disabled={BUSY}>
                          <option value="unosc">unosc</option>
                          <option value="osc">osc</option>
                        </select>
                      </div>
                      <div className="train-config-item">
                        <label className="train-config-label">flavor</label>
                        <select className="train-config-input"
                          value={dataObj.flavor ?? "numu"}
                          onChange={(e) => updateIoField(dataKey, { ...dataObj, flavor: e.target.value })}
                          disabled={BUSY}>
                          <option value="numu">numu</option>
                          <option value="numubar">numubar</option>
                          <option value="nue">nue</option>
                          <option value="nuebar">nuebar</option>
                        </select>
                      </div>
                      <div className="train-config-item">
                        <label className="train-config-label">beam_mode</label>
                        <select className="train-config-input"
                          value={dataObj.beam_mode ?? "FHC"}
                          onChange={(e) => updateIoField(dataKey, { ...dataObj, beam_mode: e.target.value })}
                          disabled={BUSY}>
                          <option value="FHC">FHC</option>
                          <option value="RHC">RHC</option>
                        </select>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
            <button className="train-config-btn"
              onClick={addIoSlot} disabled={BUSY}
              style={{ width: "100%", marginTop: 6 }}>
              + Add Sample Set
            </button>
          </div>
        )}

        {/* ── model_config ─────────────────────────────────────────────── */}
        {activeBenchTab === "model" && (
          <div style={{ padding: 10 }}>
            <p style={{ fontSize: "0.75rem", opacity: 0.6, margin: "0 0 10px" }}>
              Section: {manifest.model_config}
            </p>
            <textarea
              className="train-config-input train-config-textarea"
              style={{ minHeight: 260 }}
              value={JSON.stringify(modelConfig, null, 2)}
              onChange={(e) => { try { setModelConfig(JSON.parse(e.target.value)); } catch {} }}
              disabled={BUSY} />
          </div>
        )}

        {/* ── build status ─────────────────────────────────────────────── */}
        {activeBenchTab === "status" && (
          <div style={{ padding: 10 }}>
            {buildStatus ? (
              buildStatus.built ? (
                <div className="panel-success">
                  <div><strong>built</strong> ({buildStatus.model_name ?? "?"})</div>
                  <div style={{ marginTop: 8 }}>train: {buildStatus.benchmark_train ?? "—"}</div>
                  <div>val: {buildStatus.benchmark_val ?? "—"}</div>
                  <div>test: {buildStatus.benchmark_test ?? "—"}</div>
                  {buildStatus.elapsed_seconds != null && (
                    <div style={{ marginTop: 6, opacity: 0.7 }}>
                      elapsed: {buildStatus.elapsed_seconds.toFixed(1)}s
                    </div>
                  )}
                </div>
              ) : (
                <div className="panel-status">not built yet — click Build to start</div>
              )
            ) : (
              <div className="panel-status">no build status available</div>
            )}
          </div>
        )}
      </div>

      {/* sticky footer */}
      <div className="panel-sticky-footer" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <FeedbackSlot error={error} message={message}
          loadingText={building ? "Building..." : saving ? "Saving..." : ""} />
        <div style={{ display: "flex", gap: 8 }}>
          <button className="train-config-btn" onClick={load} disabled={BUSY}>Refresh</button>
          <button className="train-config-btn" onClick={handleSave} disabled={BUSY}>
            {saving ? "Saving..." : "Save"}
          </button>
          <button className="train-config-btn train-config-btn-primary" onClick={handleBuild} disabled={BUSY}>
            {building ? "Building..." : "Build"}
          </button>
        </div>
      </div>
    </div>
  );
}
