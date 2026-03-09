export async function sendChat(message) {

  console.log("Sending chat:", message);

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session_id: "default-session",
      message,
    }),
  });

  console.log("Response status:", response.status);

  if (!response.ok) {
    throw new Error(`Chat request failed: ${response.status}`);
  }

  const data = await response.json();

  console.log("Response JSON:", data);

  return data;
}