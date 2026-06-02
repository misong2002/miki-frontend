import { buildApiUrl } from "../../../api";

const AGENT_API_BASE = "/api/agent";

async function parseJsonResponse(response, fallbackMessage) {
  const data = await response.json().catch(() => null);

  if (!response.ok || data?.ok === false) {
    throw new Error(
      data?.error || data?.message || `${fallbackMessage}: ${response.status}`
    );
  }

  return data;
}

function buildMultipartPayload({ file, task, extra = {} }) {
  const form = new FormData();
  form.append("file", file);

  if (task) {
    form.append("task", task);
  }

  Object.entries(extra).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      form.append(key, String(value));
    }
  });

  return form;
}

export async function readDocument({
  text = "",
  url = "",
  arxivId = "",
  file = null,
  task = "",
} = {}) {
  const endpoint = buildApiUrl(`${AGENT_API_BASE}/read-paper`);

  if (file) {
    const response = await fetch(endpoint, {
      method: "POST",
      body: buildMultipartPayload({
        file,
        task,
        extra: {
          url,
          arxiv_id: arxivId,
        },
      }),
    });

    return parseJsonResponse(response, "read document failed");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      url,
      arxiv_id: arxivId,
      task,
    }),
  });

  return parseJsonResponse(response, "read document failed");
}

export async function webSearch({
  query = "",
  limit = 6,
  provider = "auto",
  summarize = true,
} = {}) {
  const response = await fetch(buildApiUrl(`${AGENT_API_BASE}/web-search`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      limit,
      provider,
      summarize,
    }),
  });

  return parseJsonResponse(response, "web search failed");
}
