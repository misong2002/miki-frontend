const MAX_TAG_BUFFER_LENGTH = 768;
const CONTROL_TAG_PATTERN = /^[a-zA-Z0-9_-]+$/;
const CONFIG_PATH_PATTERN = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/;
const HIDDEN_CONTROL_TEXT_PATTERNS = [
  /<<\s*(?:emotion|motion)\s*:\s*[a-zA-Z0-9_-]*\s*>>/gi,
  /<<\s*config:set\s+[A-Za-z0-9_.]+\s*=\s*[\s\S]*?\s*>>/gi,
  /<<\s*initialization_ready\s*>>/gi,
  /\[\[\s*use_tool\s*:\s*\{[\s\S]*?\}\s*\]\]/gi,
  /\[\[\s*say\s*:[\s\S]*?\]\]/gi,
];

function parseConfigValue(rawValue) {
  const value = String(rawValue ?? "").trim();
  if (!value) return "";

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseClosedTag(tag) {
  if (/^\[\[\s*use_tool\s*:\s*\{[\s\S]*?\}\s*\]\]$/i.test(tag)) {
    return {
      text: "",
      events: [],
    };
  }

  const sayMatch = tag.match(/^\[\[\s*say\s*:\s*([\s\S]*?)\s*\]\]$/i);
  if (sayMatch) {
    return {
      text: "",
      events: [],
    };
  }

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

  if (/^<<\s*(?:emotion|motion)\s*:\s*>>$/i.test(tag)) {
    return {
      text: "",
      events: [],
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

  match = tag.match(/^<<config:set\s+([A-Za-z0-9_.]+)\s*=\s*([\s\S]*?)\s*>>$/i);
  if (match && CONFIG_PATH_PATTERN.test(match[1])) {
    return {
      text: "",
      events: [
        {
          type: "config",
          op: "set",
          path: match[1],
          value: parseConfigValue(match[2]),
        },
      ],
    };
  }

  return {
    text: tag,
    events: [],
  };
}

function isHiddenControlTagPrefix(tag) {
  return (
    /^<<?\s*(emotion|motion|config:set|initialization_ready)\b/i.test(tag) ||
    /^\[\[\s*(use_tool|say)\b/i.test(tag)
  );
}

export function stripHiddenControlText(text = "") {
  let cleaned = String(text ?? "");

  for (const pattern of HIDDEN_CONTROL_TEXT_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }

  return cleaned
    .replace(/^[ \t]+\n/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isClosedTag(tag) {
  const isSingleClosed =
    tag.startsWith("<") &&
    !tag.startsWith("<<") &&
    tag.endsWith(">");

  const isDoubleClosed =
    tag.startsWith("<<") &&
    tag.endsWith(">>");
  const isToolClosed =
    tag.startsWith("[[") &&
    tag.endsWith("]]");

  return isSingleClosed || isDoubleClosed || isToolClosed;
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
        } else if (ch === "[") {
          state = "TAG";
          tagBuffer = "[";
        } else {
          text += ch;
        }
        continue;
      }

      if (tagBuffer === "[" && ch !== "[") {
        text += tagBuffer + ch;
        state = "TEXT";
        tagBuffer = "";
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
      text = isHiddenControlTagPrefix(tagBuffer) ? "" : tagBuffer;
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
