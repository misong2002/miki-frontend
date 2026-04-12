// src/App.jsx
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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

const MODE_LOADING = "__APP_MODE_LOADING__";

const IS_DEV =
  typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV);

function BootShell({ text = "正在同步状态……" }) {
  return (
    <div className="boot-stage-screen">
      <div className="boot-stage-copy">{text}</div>
    </div>
  );
}

function StageSurface({
  className,
  stageProps,
  hidden = false,
  loadingText = "",
}) {
  return (
    <main className={className}>
      {hidden ? (
        <BootShell text={loadingText || "正在准备舞台……"} />
      ) : (
        <Live2DStage
          modelKey={stageProps.modelKey}
          position={stageProps.position}
          scale={stageProps.scale}
        />
      )}
    </main>
  );
}

function ChatModeView({
  params,
  setParams,
  onBattle,
  panelDisabled,
  chatBootReady,
  chatShellReady,
  initialChatMessages,
  bootLoadingText,
  hideStageModel,
  chatAgent,
  stageProps,
}) {
  return (
    <>
      <aside className="param-column">
        <HyperParamPanel
          params={params}
          setParams={setParams}
          onBattle={onBattle}
          disabled={panelDisabled}
        />
      </aside>

      <aside className="chat-column">
        <ChatPanel
          disabled={panelDisabled || !chatBootReady}
          bootLoading={!chatShellReady}
          bootLoadingText={bootLoadingText}
          suppressFallbackGreeting={!chatBootReady}
          chatAgent={chatAgent}
          initialMessages={initialChatMessages}
        />
      </aside>

      <StageSurface
        className="stage-column"
        stageProps={stageProps}
        hidden={hideStageModel}
        loadingText={bootLoadingText}
      />
    </>
  );
}

function BattleModeView({
  battle,
  battleExiting,
  onForceExitBattle,
  stageProps,
}) {
  return (
    <main className="battle-layout">
      <aside className="battle-loss-column">
        <BattlePanel
          lossData={battle.lossData}
          sourcePath={APP_CONFIG.lossFilePath}
          onForceExit={onForceExitBattle}
          exiting={battleExiting}
        />
      </aside>

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
    </main>
  );
}

export default function App() {
  const [mode, setMode] = useState(MODE_LOADING);
  const [params, setParams] = useState(initialHyperParams);
  const [stageProps, setStageProps] = useState(DEFAULT_STAGE_PROPS);
  const [stageHydratedFromAgent, setStageHydratedFromAgent] = useState(false);
  const [whiteTransitionPhase, setWhiteTransitionPhase] = useState("idle");
  const lastStableModeRef = useRef(MODE_LOADING);

  const handleStageChange = useCallback((nextStageProps) => {
    if (!nextStageProps) return;
    setStageProps(nextStageProps);
  }, []);

  const { agent, initialStageProps } = useMikiAgent({
    onStageChange: handleStageChange,
  });


  useEffect(() => {
    if (stageHydratedFromAgent) return;
    if (!initialStageProps) return;

    console.log("[App] hydrating initial stage props:", initialStageProps);
    setStageProps(initialStageProps);
    setStageHydratedFromAgent(true);
  }, [initialStageProps, stageHydratedFromAgent]);


  useLayoutEffect(() => {
    if (mode === MODE_LOADING) return;

    const previousMode = lastStableModeRef.current;
    lastStableModeRef.current = mode;

    if (previousMode === MODE_LOADING || previousMode === mode) {
      return;
    }

    let cancelled = false;
    let frame1 = 0;
    let frame2 = 0;
    let timeoutId = 0;

    setWhiteTransitionPhase("visible");

    frame1 = window.requestAnimationFrame(() => {
      frame2 = window.requestAnimationFrame(() => {
        if (cancelled) return;
        timeoutId = window.setTimeout(() => {
          if (cancelled) return;
          setWhiteTransitionPhase("fading");
          timeoutId = window.setTimeout(() => {
            if (!cancelled) {
              setWhiteTransitionPhase("idle");
            }
          }, 2000);
        }, 1000);
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame1);
      window.cancelAnimationFrame(frame2);
      window.clearTimeout(timeoutId);
    };
  }, [mode]);

  const {
    chatBootReady,
    chatShellReady,
    initialChatMessages,
    bootPhase,
    bootLoadingText,
    hideStageModel,
  } = useChatBootstrap({
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
    battleBootstrapResolved,
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
    console.log("[App] startup state:", {
      mode,
      battleBootstrapResolved,
      chatBootReady,
      chatShellReady,
      bootPhase,
    });
  }, [mode, battleBootstrapResolved, chatBootReady, chatShellReady, bootPhase]);

  useEffect(() => {
    if (!IS_DEV) return;
    console.log("[App] mode =", mode);
    console.log("[App] bootPhase =", bootPhase);
    console.log("[App] stageProps =", stageProps);
  }, [mode, bootPhase, stageProps]);

  useEffect(() => {
    if (!IS_DEV) return;
    if (typeof window === "undefined") return;

    const debugAPI =
      agent && typeof agent.getDebugAPI === "function"
        ? agent.getDebugAPI()
        : null;

    console.log("[App] agent =", agent);
    console.log("[App] debugAPI =", debugAPI);

    if (debugAPI) {
      window.mikiCharacterDebug = debugAPI;
    } else {
      delete window.mikiCharacterDebug;
    }

    return () => {
      delete window.mikiCharacterDebug;
    };
  }, [agent]);

  const isModeLoading = mode === MODE_LOADING;
  const isTransforming = mode === AppMode.TRANSFORMING;

  /**
   * 这里刻意把 TRANSFORMING 归到 Chat 壳层：
   * - 不改底层 mode 语义
   * - 但顶层不再因为 TRANSFORMING 直接把整套 UI 拿掉
   * - 至少能保证变身阶段仍然有 stage 容器和原有壳层
   */
  const showChatShell =
    mode === AppMode.CHAT || mode === AppMode.TRANSFORMING;
  const showBattleShell = mode === AppMode.BATTLE;

  /**
   * 只有在真正的 CHAT 引导阶段才隐藏 stage；
   * TRANSFORMING 时保留 stage，叠 overlay。
   */
  const shouldHideStageInChatShell =
    mode === AppMode.CHAT && Boolean(hideStageModel);

  const showGlobalBootShell =
    isModeLoading ||
    !battleBootstrapResolved ||
    (mode === AppMode.CHAT && !chatShellReady);

  const rootModeClass = showGlobalBootShell ? "booting" : mode;

  useEffect(() => {
    console.log("[App] loading gate", {
      showGlobalBootShell,
      mode,
      battleBootstrapResolved,
      chatBootReady,
      bootPhase,
    });
  }, [showGlobalBootShell, mode, battleBootstrapResolved, chatBootReady, chatShellReady, bootPhase]);

  return (
    <div className={`app-root mode-${rootModeClass}`}>
      <TransitionOverlay visible={isTransforming} />
      <div className={`app-mode-whiteout phase-${whiteTransitionPhase}`} />

      {showGlobalBootShell ? (
        <BootShell text={bootLoadingText || "正在同步状态……"} />
      ) : showChatShell ? (
        <ChatModeView
          params={params}
          setParams={setParams}
          onBattle={handleEnterBattleMode}
          panelDisabled={isTransforming}
          chatBootReady={chatBootReady}
          chatShellReady={chatShellReady}
          initialChatMessages={initialChatMessages}
          bootLoadingText={bootLoadingText}
          hideStageModel={shouldHideStageInChatShell}
          chatAgent={agent.chat}
          stageProps={stageProps}
        />
      ) : showBattleShell ? (
        <BattleModeView
          battle={battle}
          battleExiting={battleExiting}
          onForceExitBattle={handleForceExitBattle}
          stageProps={stageProps}
        />
      ) : (
        <BootShell text="正在同步状态……" />
      )}

      {APP_CONFIG?.showLive2DDebug && <Live2DDebugPanel />}
    </div>
  );
}