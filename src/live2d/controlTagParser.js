const CONTROL_TAG_REGEX = /<<(\w+):([^>]+)>>/g;

export function parseControlTags(chunk) {
  const events = [];
  let visibleText = "";
  let lastIndex = 0;

  chunk.replace(CONTROL_TAG_REGEX, (full, key, value, offset) => {
    visibleText += chunk.slice(lastIndex, offset);
    lastIndex = offset + full.length;

    events.push({
      type: key.trim(),
      value: value.trim(),
      raw: full,
    });

    return full;
  });

  visibleText += chunk.slice(lastIndex);

  return {
    text: visibleText,
    events,
  };
}