import { buildApiUrl } from "../../../api";

export async function fetchBenchmarkConfig() {
  const res = await fetch(buildApiUrl("/api/benchmark/config"));
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function saveBenchmarkConfig({ config, io_config, model_config }) {
  const res = await fetch(buildApiUrl("/api/benchmark/config"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config, io_config, model_config }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function buildBenchmark({ configPath, force } = {}) {
  const res = await fetch(buildApiUrl("/api/benchmark/build"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config_path: configPath || null, force: !!force }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchFluxes() {
  const res = await fetch(buildApiUrl("/api/benchmark/fluxes"));
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function registerFlux(flux) {
  const res = await fetch(buildApiUrl("/api/benchmark/fluxes"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ flux }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteFlux(name) {
  const res = await fetch(buildApiUrl(`/api/benchmark/fluxes/${encodeURIComponent(name)}`), {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchSections() {
  const res = await fetch(buildApiUrl("/api/benchmark/sections"));
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchDatasets() {
  const res = await fetch(buildApiUrl("/api/benchmark/datasets"));
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
