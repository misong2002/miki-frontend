import { buildApiUrl } from "../../../api";

export async function startBattle(config) {
  const res = await fetch(buildApiUrl("/api/battle/start"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(config ?? {}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }

  return res.json();
}

export async function stopBattle() {
  const response = await fetch(buildApiUrl("/api/battle/stop"), {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Failed to stop battle: ${response.status}`);
  }

  return await response.json();
}

export async function fetchLossData() {
  const response = await fetch(buildApiUrl("/api/battle/loss"));

  if (!response.ok) {
    throw new Error(`Failed to fetch loss data: ${response.status}`);
  }
  return await response.json();
}

export async function fetchBattleStatus() {
  const response = await fetch(buildApiUrl("/api/battle/status"));

  if (!response.ok) {
    throw new Error(`Failed to fetch battle status: ${response.status}`);
  }

  return await response.json();
}

export async function fetchTrainingLossSummaryPrompt() {
  const response = await fetch(buildApiUrl("/api/battle/loss-summary-prompt"));

  if (!response.ok) {
    throw new Error(`Failed to fetch training loss summary prompt: ${response.status}`);
  }

  return await response.json();
}

export async function fetchTrainingLiveLog(offset = null) {
  const query =
    Number.isFinite(offset) && offset >= 0
      ? `?offset=${encodeURIComponent(offset)}`
      : "";
  const response = await fetch(buildApiUrl(`/api/battle/train-live-log${query}`));

  if (!response.ok) {
    throw new Error(`Failed to fetch train live log: ${response.status}`);
  }

  return await response.json();
}
