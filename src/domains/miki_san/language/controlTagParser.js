const MAX_TAG_BUFFER_LENGTH = 128;
const CONTROL_TAG_PATTERN = /^[a-zA-Z0-9_-]+$/;

function parseClosedTag(tag) {
  if (tag === "<<initialization_ready>>") {
    return {
      text: "",
      events: [],
    };
  }

  let match = tag.match(/^<<emotion:\s*([a-zA-Z0-9_-]+)\s*>>$/i);
  if (match && CONTROL_TAG_PATTERN.test(match[1])) {
    return {
      text: "",
      events: [{ type: "emotion", value: match[1] }],
    };
  }

  match = tag.match(/^<<motion:\s*([a-zA-Z0-9_-]+)\s*>>$/i);
  if (match && CONTROL_TAG_PATTERN.test(match[1])) {
    return {
      text: "",
      events: [{ type: "motion", value: match[1] }],
    };
  }

  match = tag.match(/^<emotion:\s*([a-zA-Z0-9_-]+)\s*>$/i);
  if (match && CONTROL_TAG_PATTERN.test(match[1])) {
    return {
      text: "",
      events: [{ type: "emotion", value: match[1] }],
    };
  }

  match = tag.match(/^<motion:\s*([a-zA-Z0-9_-]+)\s*>$/i);
  if (match && CONTROL_TAG_PATTERN.test(match[1])) {
    return {
      text: "",
      events: [{ type: "motion", value: match[1] }],
    };
  }

  return {
    text: tag,
    events: [],
  };
}

function isClosedTag(tag) {
  const isSingleClosed =
    tag.startsWith("<") &&
    !tag.startsWith("<<") &&
    tag.endsWith(">");

  const isDoubleClosed =
    tag.startsWith("<<") &&
    tag.endsWith(">>");

  return isSingleClosed || isDoubleClosed;
}

export function createControlStreamParser() {
  let state = "TEXT";
  let tagBuffer = "";

  function reset() {
    state = "TEXT";
    tagBuffer = "";
  }

  function push(chunk = "") {
    let text = "";
    const events = [];

    for (let i = 0; i < chunk.length; i += 1) {
      const ch = chunk[i];

      if (state === "TEXT") {
        if (ch === "<") {
          state = "TAG";
          tagBuffer = "<";
        } else {
          text += ch;
        }
        continue;
      }

      tagBuffer += ch;

      if (isClosedTag(tagBuffer)) {
        const parsed = parseClosedTag(tagBuffer);
        text += parsed.text;
        events.push(...parsed.events);
        state = "TEXT";
        tagBuffer = "";
        continue;
      }

      if (tagBuffer.length > MAX_TAG_BUFFER_LENGTH) {
        text += tagBuffer;
        state = "TEXT";
        tagBuffer = "";
      }
    }

    return { text, events };
  }

  function flush() {
    let text = "";

    if (state === "TAG" && tagBuffer) {
      text = tagBuffer;
    }

    reset();

    return { text, events: [] };
  }

  return {
    push,
    flush,
    reset,
  };
}