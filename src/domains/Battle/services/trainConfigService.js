import { buildApiUrl } from "../../../api";

export async function fetchTrainConfig() {
  const res = await fetch(buildApiUrl("/api/train-config"), {
    method: "GET",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }

  return res.json();
}

export async function saveTrainConfig(config) {
  const res = await fetch(buildApiUrl("/api/train-config"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ config }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }

  return res.json();
}
