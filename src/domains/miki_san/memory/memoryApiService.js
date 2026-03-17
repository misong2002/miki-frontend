// src/domains/miki_san/memory/memoryApiService.js

const MEMORY_API_BASE = "/api/memory";

async function parseJsonResponse(response) {
  let data = null;

  try {
    data = await response.json();
  } catch (err) {
    data = null;
  }

  if (!response.ok) {
    const message =
      data?.error ||
      data?.message ||
      `Memory API request failed: ${response.status}`;
    throw new Error(message);
  }

  return data;
}

export async function fetchSystemPromptMemory() {
  const response = await fetch(`${MEMORY_API_BASE}/system-prompt`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });

  return parseJsonResponse(response);
}

export async function fetchLongTermMemorySnapshot({
  summaryLimit = 10,
  ideaLimit = 10,
} = {}) {
  const params = new URLSearchParams({
    summary_limit: String(summaryLimit),
    idea_limit: String(ideaLimit),
  });

  const response = await fetch(
    `${MEMORY_API_BASE}/snapshot?${params.toString()}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  return parseJsonResponse(response);
}

export async function archiveWakeCycleToBackend(payload) {
  const response = await fetch(`${MEMORY_API_BASE}/archive`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return parseJsonResponse(response);
}

export async function rebuildSystemPromptDigest() {
  const response = await fetch(`${MEMORY_API_BASE}/rebuild-digest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  return parseJsonResponse(response);
}

