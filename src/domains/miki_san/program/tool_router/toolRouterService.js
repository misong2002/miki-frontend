import { buildApiUrl } from "../../../../api";

async function parseJsonResponse(response, fallbackMessage) {
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || data?.message || `${fallbackMessage}: ${response.status}`);
  }
  return data;
}

export async function routeTools({
  message = "",
  hasAttachment = false,
  attachmentName = "",
  recentMessages = [],
} = {}) {
  const response = await fetch(buildApiUrl("/api/program/tool-router"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      has_attachment: hasAttachment,
      attachment_name: attachmentName,
      recent_messages: recentMessages,
    }),
  });

  return parseJsonResponse(response, "tool routing failed");
}
