import { buildApiUrl } from "../../../api";

export async function sendChatStream(message, onToken, signal, options = {}) {

  const response = await fetch(buildApiUrl("/api/chat"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message,
      display_message: options?.displayMessage ?? message,
      message_type: options?.messageType ?? "user"
    }),
    signal
  })

  if (!response.ok) {
    throw new Error(`Chat request failed: ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  let buffer = ""

  while (true) {

    const { done, value } = await reader.read()

    if (done) break

    buffer += decoder.decode(value)

    const lines = buffer.split("\n")
    buffer = lines.pop() || ""

    for (const line of lines) {

      if (!line.trim()) continue

      const data = JSON.parse(line)

      if (data.debug_retrieval) {
        // console.log("[memory retrieve]", data.debug_retrieval)
        // console.log(
        //   "[memory injected block]",
        //   data.debug_retrieval.injected_memory_block || "(none)"
        // )
      }

      if (data.tool_status) {
        options?.onToolStatus?.({
          ...data.tool_status,
          at: Date.now(),
        })
      }

      if (data.model_info) {
        options?.onModelInfo?.(data.model_info)
      }

      if (Array.isArray(data.references)) {
        options?.onReferences?.(data.references)
      }

      if (data.token) {
        onToken(data.token)
      }
    }
  }
}
