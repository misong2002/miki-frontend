export async function runLanguageTurn(
  language,
  input,
  handlers = {},
  options = {}
) {
  let latestAssistantText = "";
  let finalAssistantText = "";
  let interrupted = false;
  let errorObj = null;

  const wrappedHandlers = {
    ...handlers,

    onTextUpdate: (fullText) => {
      latestAssistantText = fullText ?? "";
      handlers.onTextUpdate?.(fullText);
    },

    onDone: (finalText) => {
      finalAssistantText = finalText ?? latestAssistantText ?? "";
      handlers.onDone?.(finalText);
    },

    onInterrupted: (partialText) => {
      interrupted = true;
      finalAssistantText = partialText ?? latestAssistantText ?? "";
      handlers.onInterrupted?.(partialText);
    },

    onError: (err, partialText) => {
      errorObj = err;
      finalAssistantText =
        partialText ?? latestAssistantText ?? finalAssistantText ?? "";
      handlers.onError?.(err, partialText);
    },
  };

  const result = await language.hear(input, wrappedHandlers, options);

  const assistantText =
    (typeof result?.text === "string" && result.text) ||
    finalAssistantText ||
    latestAssistantText ||
    "";

  return {
    result,
    assistantText,
    interrupted,
    errorObj,
  };
}