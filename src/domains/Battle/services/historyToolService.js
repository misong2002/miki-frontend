const RAW_API_BASE =
  import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:5000";
const API_BASE = RAW_API_BASE.replace(/\/+$/, "");

async function readJsonResponse(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`invalid json response: ${text.slice(0, 200)}`);
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });

  const data = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(
      data?.error || data?.message || `request failed: ${response.status}`
    );
  }

  return data;
}

export async function fetchHistorySessions() {
  const result = await requestJson(`${API_BASE}/api/history/sessions`, {
    method: "GET",
  });

  return result?.sessions ?? [];
}

export async function runHistoryInitialize(sessionId) {
  return requestJson(`${API_BASE}/api/history/initialize`, {
    method: "POST",
    body: JSON.stringify({
      session_id: sessionId,
    }),
  });
}

export async function runHistoryPlot(sessionId) {
  return requestJson(`${API_BASE}/api/history/plot`, {
    method: "POST",
    body: JSON.stringify({
      session_id: sessionId,
    }),
  });
}