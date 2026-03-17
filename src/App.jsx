// src/App.jsx
import { useEffect, useState } from "react";
import ChatPanel from "./domains/Chat/components/ChatPanel";
import HyperParamPanel from "./domains/Battle/components/HyperParamPanel";
import TransitionOverlay from "./domains/Shared/TransitionOverlay";
import Live2DStage from "./domains/Shared/Live2DStage";
import ContactPanel from "./domains/Chat/components/ContactPanel";
import BattlePanel from "./domains/Battle/components/BattlePanel";
import Live2DDebugPanel from "./domains/Shared/Live2DDebugPanel";

import {
  AppMode,
  initialHyperParams,
  initialBattleState,
} from "./state/appStore";

import { APP_CONFIG } from "./config";
import { useMikiAgent } from "./hooks/useMikiAgent";
import { useUserActivityTouch } from "./hooks/useUserActivityTouch";
import { useChatBootstrap } from "./hooks/useChatBootstrap";
import { useBattleController } from "./hooks/useBattleController";

const DEFAULT_STAGE_PROPS = {
  modelKey: "normal",
  position: { x: 0.5, y: 1.0 },
  scale: 1.0,
};

const MAGICAL_STAGE_PROPS = {
  modelKey: "magical",
  position: { x: 0.5, y: 1.0 },
  scale: 1.0,
};

export default function App() {
  const [mode, setMode] = useState(AppMode.CHAT);
  const [params, setParams] = useState(initialHyperParams);

  const { agent, initialStageProps } = useMikiAgent({
    onStageChange: (nextStageProps) => {
      setStageProps(nextStageProps);
    },
  });

  const [stageProps, setStageProps] = useState(
    initialStageProps ?? DEFAULT_STAGE_PROPS
  );

  const { chatBootReady, initialChatMessages } = useChatBootstrap({
    chatAgent: agent.chat,
    appAgent: agent.app,
    mode,
    chatModeValue: AppMode.CHAT,
  });

  const {
    battle,
    battleExiting,
    handleEnterBattleMode,
    handleForceExitBattle,
  } = useBattleController({
    battleAgent: agent.battle,
    appAgent: agent.app,
    stageAgent: agent.stage,
    mode,
    setMode,
    appModeEnum: AppMode,
    initialBattleState,
    defaultStageProps: DEFAULT_STAGE_PROPS,
    magicalStageProps: MAGICAL_STAGE_PROPS,
  });

  useUserActivityTouch({
    appAgent: agent.app,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    window.mikiCharacterDebug = agent?.getDebugAPI?.();

    return () => {
      delete window.mikiCharacterDebug;
    };
  }, [agent]);

  return (
    <div className={`app-root mode-${mode}`}>
      <TransitionOverlay visible={mode === AppMode.TRANSFORMING} />

      {mode === AppMode.CHAT && (
        <>
          <aside className="param-column">
            <HyperParamPanel
              params={params}
              setParams={setParams}
              onBattle={handleEnterBattleMode}
              disabled={false}
            />
          </aside>

          <main className="stage-column">
            <Live2DStage
              modelKey={stageProps.modelKey}
              position={stageProps.position}
              scale={stageProps.scale}
            />
          </main>

          <aside className="chat-column">
            <ChatPanel
              disabled={!chatBootReady}
              bootLoading={!chatBootReady}
              chatAgent={agent.chat}
              initialMessages={initialChatMessages}
            />
          </aside>
        </>
      )}

      {mode === AppMode.BATTLE && (
        <main className="battle-layout">
          <aside className="battle-contact-column">
            <ContactPanel messages={battle.contactMessages} />
          </aside>

          <section className="battle-stage-column">
            <Live2DStage
              modelKey={stageProps.modelKey}
              position={stageProps.position}
              scale={stageProps.scale}
            />
          </section>

          <aside className="battle-loss-column">
            <BattlePanel
              lossData={battle.lossData}
              sourcePath={APP_CONFIG.lossFilePath}
              onForceExit={handleForceExitBattle}
              exiting={battleExiting}
            />
          </aside>
        </main>
      )}

      {APP_CONFIG?.showLive2DDebug && <Live2DDebugPanel />}
    </div>
  );
}