import { buildApiUrl } from "../../../api";

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
  const result = await requestJson(buildApiUrl("/api/history/sessions"), {
    method: "GET",
  });

  return result?.sessions ?? [];
}

export async function runHistoryInitialize(sessionId) {
  return requestJson(buildApiUrl("/api/history/initialize"), {
    method: "POST",
    body: JSON.stringify({
      session_id: sessionId,
    }),
  });
}

export async function runHistoryPlot(sessionId) {
  return requestJson(buildApiUrl("/api/history/plot"), {
    method: "POST",
    body: JSON.stringify({
      session_id: sessionId,
    }),
  });
}
