import { useRef } from "react";
import { createMikiAgent } from "../domains/miki_san/createMikiAgent";

const STAGE_STATE_STORAGE_KEY = "miki.stage.state.v1";

const FALLBACK_STAGE_PROPS = {
  modelKey: "normal",
  position: { x: 0.5, y: 1.0 },
  scale: 1.0,
};

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeStageProps(value) {
  if (!value || typeof value !== "object") return FALLBACK_STAGE_PROPS;

  const modelKey =
    value.modelKey === "magical" || value.modelKey === "normal"
      ? value.modelKey
      : FALLBACK_STAGE_PROPS.modelKey;
  const position = {
    x: isFiniteNumber(value.position?.x)
      ? value.position.x
      : FALLBACK_STAGE_PROPS.position.x,
    y: isFiniteNumber(value.position?.y)
      ? value.position.y
      : FALLBACK_STAGE_PROPS.position.y,
  };
  const scale = isFiniteNumber(value.scale)
    ? value.scale
    : FALLBACK_STAGE_PROPS.scale;

  return {
    modelKey,
    position,
    scale,
  };
}

function loadPersistedStageProps() {
  if (typeof window === "undefined" || !window.localStorage) {
    return FALLBACK_STAGE_PROPS;
  }

  try {
    const raw = window.localStorage.getItem(STAGE_STATE_STORAGE_KEY);
    if (!raw) return FALLBACK_STAGE_PROPS;
    return normalizeStageProps(JSON.parse(raw));
  } catch (err) {
    console.warn("[useMikiAgent] failed to load stage state:", err);
    return FALLBACK_STAGE_PROPS;
  }
}

function savePersistedStageProps(stageProps) {
  if (typeof window === "undefined" || !window.localStorage) return;

  try {
    window.localStorage.setItem(
      STAGE_STATE_STORAGE_KEY,
      JSON.stringify(normalizeStageProps(stageProps))
    );
  } catch (err) {
    console.warn("[useMikiAgent] failed to save stage state:", err);
  }
}

export function useMikiAgent({ onStageChange } = {}) {
  const agentRef = useRef(null);
  const initialStagePropsRef = useRef(null);

  if (!agentRef.current) {
    const initialStageProps = loadPersistedStageProps();
    const created = createMikiAgent({
      initialStageProps,
      onStageChange: (nextStageProps) => {
        savePersistedStageProps(nextStageProps);
        onStageChange?.(nextStageProps);
      },
    });

    agentRef.current = created?.agent ?? null;
    initialStagePropsRef.current =
      created?.initialStageProps ?? FALLBACK_STAGE_PROPS;
  }

  return {
    agent:
      agentRef.current ?? {
        chat: {},
        app: {},
        battle: {},
        stage: {},
        getDebugAPI: null,
      },
    initialStageProps: initialStagePropsRef.current ?? FALLBACK_STAGE_PROPS,
  };
}
