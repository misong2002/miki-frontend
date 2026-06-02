import { buildApiUrl } from "../../../api";

async function parseJsonResponse(response, fallbackMessage) {
  const data = await response.json().catch(() => null);

  if (!response.ok || data?.ok === false) {
    throw new Error(
      data?.error || data?.message || `${fallbackMessage}: ${response.status}`
    );
  }

  return data;
}

export async function fetchCurrentTrainConfig() {
  const response = await fetch(buildApiUrl("/api/train-config"), {
    method: "GET",
  });
  return parseJsonResponse(response, "fetch train config failed");
}

export async function patchTrainConfig({ path, value }) {
  const response = await fetch(buildApiUrl("/api/program/train-config/patch"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      path,
      value,
    }),
  });

  return parseJsonResponse(response, "patch train config failed");
}
