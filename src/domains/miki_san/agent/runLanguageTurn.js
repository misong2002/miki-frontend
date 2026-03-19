function resolveFinalAssistantText({
  result,
  finalAssistantText,
  latestAssistantText,
}) {
  if (typeof result?.text === "string" && result.text) {
    return result.text;
  }

  if (finalAssistantText) {
    return finalAssistantText;
  }

  if (latestAssistantText) {
    return latestAssistantText;
  }

  return "";
}

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

  return {
    result,
    assistantText: resolveFinalAssistantText({
      result,
      finalAssistantText,
      latestAssistantText,
    }),
    interrupted:
      interrupted || result?.status === "interrupted" || false,
    errorObj: errorObj ?? result?.error ?? null,
  };
}