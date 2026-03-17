// src/hooks/useMikiAgent.js
import { useRef } from "react";
import { createMikiAgent } from "../domains/miki_san/createMikiAgent";

export function useMikiAgent({ onStageChange } = {}) {
  const agentRef = useRef(null);
  const initialStagePropsRef = useRef(null);

  if (!agentRef.current) {
    const agent = createMikiAgent({
      onStageChange,
    });

    agentRef.current = agent;
    initialStagePropsRef.current =
      agent?.stage?.getSnapshot?.() ?? {
        modelKey: "normal",
        position: { x: 0.5, y: 1.0 },
        scale: 1.0,
      };
  }

  return {
    agent: agentRef.current,
    initialStageProps: initialStagePropsRef.current,
  };
}