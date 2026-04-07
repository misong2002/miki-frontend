// src/domains/Battle/services/historyService.js

const RAW_API_BASE =
  import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:5000";
const API_BASE = RAW_API_BASE.replace(/\/+$/, "");

export async function saveTrainingHistory(
  trainConfig = "config/train_config.json"
) {
  const res = await fetch(`${API_BASE}/api/history/save-history`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      train_config: trainConfig,
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `saveTrainingHistory failed: ${res.status}`);
  }

  return data;
}