import { buildApiUrl } from "../../../../api";

const CODE_AGENT_API_BASE = "/api/program/code-agent";

async function parseJsonResponse(response, fallbackMessage) {
  const data = await response.json().catch(() => null);

  if (!response.ok || data?.ok === false) {
    throw new Error(
      data?.error || data?.message || `${fallbackMessage}: ${response.status}`
    );
  }

  return data;
}

async function postCodeAgent(endpoint, payload = {}, fallbackMessage = "code agent request failed") {
  const response = await fetch(buildApiUrl(`${CODE_AGENT_API_BASE}/${endpoint}`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return parseJsonResponse(response, fallbackMessage);
}

export function listCodeFiles({
  path = "",
  pattern = "*",
  recursive = true,
  limit = 500,
} = {}) {
  return postCodeAgent(
    "list",
    {
      path,
      pattern,
      recursive,
      limit,
    },
    "list code files failed"
  );
}

export function readCodeFile({ path = "" } = {}) {
  return postCodeAgent(
    "read",
    {
      path,
    },
    "read code file failed"
  );
}

export function searchCode({
  query = "",
  path = "",
  pattern = "*",
  limit = 80,
} = {}) {
  return postCodeAgent(
    "search",
    {
      query,
      path,
      pattern,
      limit,
    },
    "search code failed"
  );
}
