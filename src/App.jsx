// src/App.jsx
import { useCallback, useEffect, useState } from "react";
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

/**
 * 仅作为 App 顶层的“模式未决”占位值：
 * - 不改底层 AppMode 枚举
 * - 但避免把“还没判定”误写成 CHAT
 */
const MODE_PENDING = "__APP_MODE_PENDING__";

/**
 * 给 battle 恢复逻辑一个很短的首屏 settle 窗口：
 * - 若这段时间里底层把 mode 切成 BATTLE，就不会先闪 Chat
 * - 若没有切走，则回落到 CHAT
 *
 * 这不是最终最完美方案；最终最好由底层显式暴露“初始模式已解析”信号。
 * 但在“不改底层接口”的约束下，这是顶层最稳的修法。
 */
const INITIAL_MODE_SETTLE_MS = 200;

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

      <StageSurface
        className="stage-column"
        stageProps={stageProps}
        hidden={hideStageModel}
        loadingText={bootLoadingText}
      />

      <aside className="chat-column">
        <ChatPanel
          disabled={panelDisabled || !chatBootReady}
          bootLoading={!chatBootReady}
          bootLoadingText={bootLoadingText}
          chatAgent={chatAgent}
          initialMessages={initialChatMessages}
        />
      </aside>
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
          onForceExit={onForceExitBattle}
          exiting={battleExiting}
        />
      </aside>
    </main>
  );
}

export default function App() {
  const [mode, setMode] = useState(MODE_PENDING);
  const [initialModeSettled, setInitialModeSettled] = useState(false);
  const [params, setParams] = useState(initialHyperParams);
  const [stageProps, setStageProps] = useState(DEFAULT_STAGE_PROPS);
  const [stageHydratedFromAgent, setStageHydratedFromAgent] = useState(false);

  const handleStageChange = useCallback((nextStageProps) => {
    if (!nextStageProps) return;
    setStageProps(nextStageProps);
  }, []);

  const { agent, initialStageProps } = useMikiAgent({
    onStageChange: handleStageChange,
  });

  /**
   * 只在首次拿到 agent 初始舞台时回填一次。
   * 后续舞台切换仍然以 onStageChange 为准，避免反复覆盖。
   */
  useEffect(() => {
    if (stageHydratedFromAgent) return;
    if (!initialStageProps) return;

    setStageProps(initialStageProps);
    setStageHydratedFromAgent(true);
  }, [initialStageProps, stageHydratedFromAgent]);

  /**
   * 首屏模式 settle：
   * - 先不给 CHAT/BATTLE 正式 UI 出场
   * - 给底层 battle 恢复逻辑一个短窗口改写 mode
   * - 若窗口结束仍未改写，则默认进入 CHAT
   */
  useEffect(() => {
    if (typeof window === "undefined") {
      setMode((prev) => (prev === MODE_PENDING ? AppMode.CHAT : prev));
      setInitialModeSettled(true);
      return;
    }

    const timer = window.setTimeout(() => {
      setMode((prev) => (prev === MODE_PENDING ? AppMode.CHAT : prev));
      setInitialModeSettled(true);
    }, INITIAL_MODE_SETTLE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  /**
   * 如果底层更早把 mode 切成了 CHAT / TRANSFORMING / BATTLE，
   * 那么可以直接认为首屏模式已经落定，不必再等 settle 计时器。
   */
  useEffect(() => {
    if (mode !== MODE_PENDING && !initialModeSettled) {
      setInitialModeSettled(true);
    }
  }, [mode, initialModeSettled]);

  const {
    chatBootReady,
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

  const isModePending = mode === MODE_PENDING;
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

  const rootModeClass = isModePending ? "booting" : mode;

  return (
    <div className={`app-root mode-${rootModeClass}`}>
      <TransitionOverlay visible={isTransforming} />

      {!initialModeSettled || isModePending ? (
        <BootShell text={bootLoadingText || "正在同步状态……"} />
      ) : showChatShell ? (
        <ChatModeView
          params={params}
          setParams={setParams}
          onBattle={handleEnterBattleMode}
          panelDisabled={isTransforming}
          chatBootReady={chatBootReady}
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