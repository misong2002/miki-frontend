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
const CHAT_MODEL_READY_EXIT_DELAY_MS = 240;
const CHAT_MODEL_READY_TIMEOUT_MS = 8000;

const IS_DEV =
  typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV);

const WITCH_BACKGROUND_MODULES = import.meta.glob(
  "/public/fig/witch/*.{png,jpg,jpeg,webp,avif,gif}",
  {
    eager: true,
    query: "?url",
    import: "default",
  }
);

const WITCH_BACKGROUNDS = Object.values(WITCH_BACKGROUND_MODULES).map((url) =>
  String(url).replace(/^\/public/, "")
);

function randomArrayItem(items) {
  if (!items.length) return "";
  return items[Math.floor(Math.random() * items.length)];
}

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
  onInteraction = null,
  onModelReady = null,
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
          onInteraction={onInteraction}
          onModelReady={onModelReady}
        />
      )}
    </main>
  );
}

function ChatModeView({
  params,
  setParams,
  onBattle,
  startBattleRequest,
  panelDisabled,
  chatBootReady,
  chatShellReady,
  initialChatMessages,
  bootLoadingText,
  hideStageModel,
  chatAgent,
  stageProps,
  interactionRequest,
  onLive2DInteraction,
  onInteractionRequestHandled,
  onTransformRequest,
  onStartTrainingRequest,
  onMoveRequest,
  onStageModelReady,
}) {
  return (
    <>
      <aside className="param-column">
        <HyperParamPanel
          params={params}
          setParams={setParams}
          onBattle={onBattle}
          startBattleRequest={startBattleRequest}
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
          interactionRequest={interactionRequest}
          onInteractionRequestHandled={onInteractionRequestHandled}
          onTransformRequest={onTransformRequest}
          onStartTrainingRequest={onStartTrainingRequest}
          onMoveRequest={onMoveRequest}
        />
      </aside>

      <StageSurface
        className="stage-column"
        stageProps={stageProps}
        hidden={hideStageModel}
        loadingText={bootLoadingText}
        onInteraction={onLive2DInteraction}
        onModelReady={onStageModelReady}
      />
    </>
  );
}

function BattleModeView({
  battle,
  battleExiting,
  historyAction,
  historyMessage,
  historyError,
  historyStatusKind,
  lastPlottedSessionId,
  plotRefreshKey,
  onForceExitBattle,
  onSaveHistoryAndPlot,
  stageProps,
  onLive2DInteraction,
}) {
  const [battleBackgroundUrl, setBattleBackgroundUrl] = useState(() =>
    randomArrayItem(WITCH_BACKGROUNDS)
  );

  useEffect(() => {
    if (WITCH_BACKGROUNDS.length <= 1) return undefined;

    const timer = window.setInterval(() => {
      setBattleBackgroundUrl((current) => {
        const candidates = WITCH_BACKGROUNDS.filter((item) => item !== current);
        return randomArrayItem(candidates.length ? candidates : WITCH_BACKGROUNDS);
      });
    }, 11000);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <main
      className="battle-layout"
      style={
        battleBackgroundUrl
          ? { "--battle-bg-image": `url("${battleBackgroundUrl}")` }
          : undefined
      }
    >
      <aside className="battle-loss-column">
        <BattlePanel
          lossData={battle.lossData}
          sourcePath={APP_CONFIG.lossFilePath}
          onForceExit={onForceExitBattle}
          onSaveHistoryAndPlot={onSaveHistoryAndPlot}
          exiting={battleExiting}
          historyAction={historyAction}
          historyMessage={historyMessage}
          historyError={historyError}
          historyStatusKind={historyStatusKind}
          lastPlottedSessionId={lastPlottedSessionId}
          plotRefreshKey={plotRefreshKey}
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
          onInteraction={onLive2DInteraction}
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
  const [chatInteractionRequest, setChatInteractionRequest] = useState(null);
  const [startBattleRequest, setStartBattleRequest] = useState(null);
  const lastStableModeRef = useRef(MODE_LOADING);
  const readyChatModelKeyRef = useRef(null);
  const pendingChatModelReadyRef = useRef(null);
  const chatTransformSequenceRef = useRef(0);

  const handleStageChange = useCallback((nextStageProps) => {
    if (!nextStageProps) return;
    setStageProps(nextStageProps);
  }, []);

  const { agent, initialStageProps } = useMikiAgent({
    onStageChange: handleStageChange,
  });

  const clearPendingChatModelReady = useCallback((result = null) => {
    const pending = pendingChatModelReadyRef.current;
    if (!pending) return;

    window.clearTimeout(pending.timeoutId);
    pendingChatModelReadyRef.current = null;
    pending.resolve(result);
  }, []);

  const waitForChatModelReady = useCallback(
    (targetModelKey) => {
      if (readyChatModelKeyRef.current === targetModelKey) {
        return Promise.resolve({ ok: true, modelKey: targetModelKey });
      }

      clearPendingChatModelReady({ ok: false, cancelled: true });

      return new Promise((resolve) => {
        const timeoutId = window.setTimeout(() => {
          if (pendingChatModelReadyRef.current?.targetModelKey !== targetModelKey) {
            return;
          }
          pendingChatModelReadyRef.current = null;
          resolve({ ok: false, timeout: true, modelKey: targetModelKey });
        }, CHAT_MODEL_READY_TIMEOUT_MS);

        pendingChatModelReadyRef.current = {
          targetModelKey,
          timeoutId,
          resolve,
        };
      });
    },
    [clearPendingChatModelReady]
  );

  const handleChatStageModelReady = useCallback(
    ({ modelKey } = {}) => {
      if (!modelKey) return;

      readyChatModelKeyRef.current = modelKey;

      const pending = pendingChatModelReadyRef.current;
      if (pending?.targetModelKey === modelKey) {
        clearPendingChatModelReady({ ok: true, modelKey });
      }
    },
    [clearPendingChatModelReady]
  );

  useEffect(() => {
    return () => {
      clearPendingChatModelReady({ ok: false, cancelled: true });
    };
  }, [clearPendingChatModelReady]);

  const handleLive2DInteraction = useCallback((payload) => {
    const isHeadTap = payload?.type === "head_tap";
    const isBodyTap = payload?.type === "body_tap";

    if (mode === AppMode.CHAT) {
      if (!isHeadTap) return;

      setChatInteractionRequest({
        id: `live2d-head-tap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text: "用户刚刚轻轻摸了摸你的头。这是一次日常互动，请结合最近对话自然回应，不要当成第一次见面。",
        displayText: "（用户摸了摸你的头）",
        payload,
      });
      return;
    }

    if (mode === AppMode.BATTLE && (isHeadTap || isBodyTap)) {
      agent.battle?.triggerIdlePresentation?.("battle_model_tap");
    }
  }, [agent.battle, mode]);

  const handleInteractionRequestHandled = useCallback((requestId) => {
    setChatInteractionRequest((current) =>
      current?.id === requestId ? null : current
    );
  }, []);

  const handleTransformRequest = useCallback(
    async ({ targetModel = "magical" } = {}) => {
      const normalizedTarget =
        targetModel === "normal" || targetModel === "magical"
          ? targetModel
          : "magical";

      setWhiteTransitionPhase("visible");

      const transformSequence = chatTransformSequenceRef.current + 1;
      chatTransformSequenceRef.current = transformSequence;

      try {
        const modelReadyPromise = waitForChatModelReady(normalizedTarget);
        agent.stage?.setStagePreset?.(normalizedTarget);
        const modelReadyResult = await modelReadyPromise;
        if (
          !modelReadyResult?.ok ||
          modelReadyResult?.cancelled ||
          chatTransformSequenceRef.current !== transformSequence
        ) {
          return {
            ok: false,
            cancelled: Boolean(modelReadyResult?.cancelled),
            timeout: Boolean(modelReadyResult?.timeout),
            targetModel: normalizedTarget,
            mode,
          };
        }
        await new Promise((resolve) =>
          window.setTimeout(resolve, CHAT_MODEL_READY_EXIT_DELAY_MS)
        );
        if (chatTransformSequenceRef.current !== transformSequence) {
          return {
            ok: false,
            cancelled: true,
            targetModel: normalizedTarget,
            mode,
          };
        }
        setWhiteTransitionPhase("fading");
        await new Promise((resolve) => window.setTimeout(resolve, 520));
      } finally {
        if (chatTransformSequenceRef.current === transformSequence) {
          setWhiteTransitionPhase("idle");
        }
      }

      return {
        ok: true,
        targetModel: normalizedTarget,
        mode,
      };
    },
    [agent.stage, mode, waitForChatModelReady]
  );

  const handleStartTrainingRequest = useCallback(() => {
    if (mode !== AppMode.CHAT) {
      return Promise.resolve({
        ok: false,
        error: "training can only be started from chat mode",
      });
    }

    return new Promise((resolve, reject) => {
      setStartBattleRequest({
        id: `start-battle-tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        resolve: (result) => {
          setStartBattleRequest(null);
          resolve(result);
        },
        reject: (err) => {
          setStartBattleRequest(null);
          reject(err);
        },
      });
    });
  }, [mode]);

  const handleMoveRequest = useCallback(
    async ({ call = {}, target = {}, durationMs = 650 } = {}) => {
      const current = agent.stage?.getStageProps?.() ?? DEFAULT_STAGE_PROPS;
      const numberOrNull = (value) => {
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
      };
      const targetX =
        numberOrNull(call.target_x ?? call.targetX ?? target.position?.x) ??
        (current.position?.x ?? DEFAULT_STAGE_PROPS.position.x) +
          (numberOrNull(call.dx) ?? 0);
      const targetY =
        numberOrNull(call.target_y ?? call.targetY ?? target.position?.y) ??
        (current.position?.y ?? DEFAULT_STAGE_PROPS.position.y) +
          (numberOrNull(call.dy) ?? 0);
      const targetScale =
        numberOrNull(call.target_scale ?? call.targetScale ?? target.scale) ??
        (current.scale ?? DEFAULT_STAGE_PROPS.scale) +
          (numberOrNull(call.scale_delta ?? call.scaleDelta ?? call.dscale) ?? 0);
      const resolvedDuration =
        numberOrNull(call.duration_ms ?? call.durationMs ?? durationMs) ?? 650;

      const result = await agent.stage?.moveStage?.(
        {
          position: {
            x: targetX,
            y: targetY,
          },
          scale: targetScale,
        },
        { durationMs: resolvedDuration }
      );
      return {
        ok: Boolean(result),
        stage: result ?? agent.stage?.getStageProps?.() ?? null,
      };
    },
    [agent.stage]
  );


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
    historyAction,
    historyMessage,
    historyError,
    historyStatusKind,
    lastPlottedSessionId,
    plotRefreshKey,
    handleEnterBattleMode,
    handleForceExitBattle,
    handleSaveHistoryAndPlot,
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
          startBattleRequest={startBattleRequest}
          panelDisabled={isTransforming}
          chatBootReady={chatBootReady}
          chatShellReady={chatShellReady}
          initialChatMessages={initialChatMessages}
          bootLoadingText={bootLoadingText}
          hideStageModel={shouldHideStageInChatShell}
          chatAgent={agent.chat}
          stageProps={stageProps}
          interactionRequest={chatInteractionRequest}
          onLive2DInteraction={handleLive2DInteraction}
          onInteractionRequestHandled={handleInteractionRequestHandled}
          onTransformRequest={handleTransformRequest}
          onStartTrainingRequest={handleStartTrainingRequest}
          onMoveRequest={handleMoveRequest}
          onStageModelReady={handleChatStageModelReady}
        />
      ) : showBattleShell ? (
        <BattleModeView
          battle={battle}
          battleExiting={battleExiting}
          historyAction={historyAction}
          historyMessage={historyMessage}
          historyError={historyError}
          historyStatusKind={historyStatusKind}
          lastPlottedSessionId={lastPlottedSessionId}
          plotRefreshKey={plotRefreshKey}
          onForceExitBattle={handleForceExitBattle}
          onSaveHistoryAndPlot={handleSaveHistoryAndPlot}
          stageProps={stageProps}
          onLive2DInteraction={handleLive2DInteraction}
        />
      ) : (
        <BootShell text="正在同步状态……" />
      )}

      {APP_CONFIG?.showLive2DDebug && <Live2DDebugPanel />}
    </div>
  );
}
