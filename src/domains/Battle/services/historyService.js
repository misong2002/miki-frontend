// src/domains/Battle/services/historyService.js
export async function saveTrainingHistory(trainConfig = "config/train_config.json") {
  const res = await fetch("/api/training/save-history", {
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