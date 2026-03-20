import { useRef } from "react";
import { createMikiAgent } from "../domains/miki_san/createMikiAgent";

const FALLBACK_STAGE_PROPS = {
  modelKey: "normal",
  position: { x: 0.5, y: 1.0 },
  scale: 1.0,
};

export function useMikiAgent({ onStageChange } = {}) {
  const agentRef = useRef(null);
  const initialStagePropsRef = useRef(null);

  if (!agentRef.current) {
    const created = createMikiAgent({
      onStageChange,
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