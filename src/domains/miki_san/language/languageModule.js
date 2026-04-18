import { sendChatStream } from "../../Chat/services/chatService";
import { createControlStreamParser } from "./controlTagParser";
import { normalizeHearInput } from "./languageUtils";
import { createLanguageRuntime } from "./languageRuntime";

export function createLanguageModule({
  streamChat = sendChatStream,
  parserFactory = createControlStreamParser,
  transferIntervalMs = 6,
  typewriterIntervalMs = 1,
  onCharacterEvent = null,
} = {}) {
  const runtime = createLanguageRuntime({
    streamChat,
    parserFactory,
    transferIntervalMs,
    typewriterIntervalMs,
    emitCharacterEvent: onCharacterEvent,
  });

  async function hear(input, handlers = {}, options = {}) {
    const normalized = normalizeHearInput(input);
    const trimmed = normalized.text.trim();

    if (!trimmed) {
      return {
        status: "idle",
        text: "",
        error: null,
      };
    }

    return runtime.hear(
      {
        text: trimmed,
        messageId: normalized.messageId,
        messageType: normalized.messageType,
      },
      handlers,
      options
    );
  }

  return {
    hear,
    interrupt: runtime.interrupt,
    isBusy: runtime.isBusy,
  };
}