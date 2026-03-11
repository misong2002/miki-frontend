import { useEffect, useRef, useState } from "react";

import ChatPanel from "./components/ChatPanel";
import HyperParamPanel from "./components/HyperParamPanel";
import TransitionOverlay from "./components/TransitionOverlay";
import Live2DStage from "./components/Live2DStage";
import ContactPanel from "./components/ContactPanel";
import BattlePanel from "./components/BattlePanel";
import Live2DDebugPanel from "./components/Live2DDebugPanel";

import {
  AppMode,
  initialHyperParams,
  initialTrainingState,
  initialBattleState,
} from "./state/appStore";

import {
  startBattle,
  stopBattle,
  fetchLossData,
} from "./services/battleService";
import { APP_CONFIG } from "./config";

import { emotionEngine } from "./live2d/emotionEngine";
import { createCharacterOrchestrator } from "./agent/features/character/characterOrchestrator";
import { createCharacterRuntimeBridge } from "./agent/features/character/characterRuntimeBridge";
import { emotionMapper } from "./agent/features/character/emotionMapper";
import { motionMapper } from "./agent/features/character/motionMapper";

import { createLanguageModule } from "./agent/features/language/languageModule";
import { createMikiAgent } from "./agent/createMikiAgent";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function App() {
  const [mode, setMode] = useState(AppMode.CHAT);
  const [modelKey, setModelKey] = useState("normal");
  const [params, setParams] = useState(initialHyperParams);
  const [training, setTraining] = useState(initialTrainingState);
  const [battle, setBattle] = useState(initialBattleState);
  const [battleExiting, setBattleExiting] = useState(false);

  const streamRef = useRef(null);
  const pollTimerRef = useRef(null);

  const runtimeBridgeRef = useRef(null);
  const characterOrchestratorRef = useRef(null);
  const languageRef = useRef(null);
  const mikiAgentRef = useRef(null);

  if (!runtimeBridgeRef.current) {
    runtimeBridgeRef.current = createCharacterRuntimeBridge({
      emotionEngine,
    });
  }

  if (!characterOrchestratorRef.current) {
    characterOrchestratorRef.current = createCharacterOrchestrator({
      runtimeBridge: runtimeBridgeRef.current,
      emotionMapper,
      motionMapper,
    });
  }

  if (!languageRef.current) {
    languageRef.current = createLanguageModule({
      onCharacterEvent: (event) => {
        characterOrchestratorRef.current?.dispatch(event);
      },
    });
  }

  if (!mikiAgentRef.current) {
    mikiAgentRef.current = createMikiAgent({
      character: characterOrchestratorRef.current,
      language: languageRef.current,
      memory: null, // 以后接真实 memory 模块
    });
  }

  const characterOrchestrator = characterOrchestratorRef.current;
  const mikiAgent = mikiAgentRef.current;

  useEffect(() => {
    emotionEngine.setAutonomousBehaviorEnabled?.(false);
  }, []);

  async function loadBattleLoss() {
    try {
      const result = await fetchLossData();
      setBattle((prev) => ({
        ...prev,
        lossData: result.data ?? [],
      }));
    } catch (err) {
      console.error("[battle] fetch loss failed:", err);
    }
  }

  function startLossPolling() {
    stopLossPolling();

    pollTimerRef.current = setInterval(() => {
      loadBattleLoss();
    }, APP_CONFIG.lossPollIntervalMs);
  }

  function stopLossPolling() {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  async function handleEnterBattleMode() {
    if (mode !== AppMode.CHAT) return;

    setMode(AppMode.TRANSFORMING);

    let startResult = null;

    try {
      startResult = await startBattle(params);
      console.log("[battle] startBattle ok:", startResult);
    } catch (err) {
      console.error("[battle] startBattle failed:", err);
      setMode(AppMode.CHAT);
      return;
    }

    await delay(150);
    setModelKey("magical");
    await delay(350);

    try {
      const result = await fetchLossData();

      setBattle((prev) => ({
        ...prev,
        contactMessages: [
          "准备好了吗？要进入结界了！",
          `*已进入魔女结界：PID ${startResult?.pid ?? "unknown"}`,
          "站在我身后就好，帮我盯着魔力波动！",
        ],
        lossData: result.data ?? [],
      }));
    } catch (err) {
      console.error("[battle] fetchLossData failed:", err);

      setBattle((prev) => ({
        ...prev,
        contactMessages: [
          "通信接通，但 loss 数据读取失败了。",
          `错误：${err.message}`,
        ],
        lossData: [],
      }));
    }

    setMode(AppMode.BATTLE);
  }

  async function handleForceExitBattle() {
    if (mode !== AppMode.BATTLE || battleExiting) return;

    setBattleExiting(true);
    stopLossPolling();

    try {
      await stopBattle();
    } catch (err) {
      console.error("[battle] stop failed:", err);
    }

    setModelKey("normal");
    setBattle(initialBattleState);
    setMode(AppMode.CHAT);
    setBattleExiting(false);
  }

  useEffect(() => {
    characterOrchestrator.dispatch({
      type: "APP_MODE_CHANGED",
      mode,
    });

    if (mode === AppMode.BATTLE) {
      emotionEngine.setMode?.("battle");

      loadBattleLoss();
      startLossPolling();

      characterOrchestrator.dispatch({
        type: "TRAINING_STATUS",
        payload: {
          status: "running",
          semantic: "focused",
        },
      });
    } else {
      emotionEngine.setMode?.("chat");

      stopLossPolling();

      characterOrchestrator.dispatch({
        type: "TRAINING_STATUS",
        payload: {
          status: "idle",
          semantic: "idle",
        },
      });
    }

    return () => {
      stopLossPolling();
    };
  }, [mode, characterOrchestrator]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    window.mikiCharacterDebug = {
      // ===== 角色状态 =====
      getCharacterState: () => characterOrchestrator.getState(),

      // ===== 原始角色事件入口 =====
      dispatchCharacter: (event) => characterOrchestrator.dispatch(event),

      startChat: (messageId = "debug-chat") =>
        characterOrchestrator.dispatch({
          type: "CHAT_START",
          messageId,
        }),

      token: (token = "debug token") =>
        characterOrchestrator.dispatch({
          type: "CHAT_TOKEN",
          token,
        }),

      endChat: (messageId = "debug-chat") =>
        characterOrchestrator.dispatch({
          type: "CHAT_END",
          messageId,
        }),

      setChatEmotion: (emotionKey) =>
        characterOrchestrator.dispatch({
          type: "CHAT_CONTROL_EMOTION",
          value: emotionKey,
        }),

      setChatMotion: (motionKey) =>
        characterOrchestrator.dispatch({
          type: "CHAT_CONTROL_MOTION",
          value: motionKey,
        }),

      setTraining: (status = "running", semantic = "focused") =>
        characterOrchestrator.dispatch({
          type: "TRAINING_STATUS",
          payload: { status, semantic },
        }),

      userActive: (source = "debug") =>
        characterOrchestrator.dispatch({
          type: "USER_ACTIVE",
          source,
        }),

      setCharacterMode: (nextMode) =>
        characterOrchestrator.dispatch({
          type: "APP_MODE_CHANGED",
          mode: nextMode,
        }),
      // ===== language 级调试 =====
      getLanguage: () => languageRef.current,

      remindLanguage: (memoryContext) =>
        languageRef.current?.remind?.(memoryContext),

      hearLanguage: async (text, extra = {}) => {
        return languageRef.current?.hear(
          {
            text,
            messageId: extra.messageId ?? "debug-language",
            memoryContext: extra.memoryContext ?? null,
          },
          {
            onThinkingStart: () => console.log("[debug language] thinking"),
            onTextChunk: (chunk) => console.log("[debug language] chunk:", chunk),
            onTextUpdate: (fullText) =>
              console.log("[debug language] full:", fullText),
            onControl: (event) =>
              console.log("[debug language] control:", event),
            onDone: (finalText) =>
              console.log("[debug language] done:", finalText),
            onInterrupted: (partialText) =>
              console.log("[debug language] interrupted:", partialText),
            onError: (err, partialText) =>
              console.error("[debug language] error:", err, partialText),
            ...extra.handlers,
          }
        );
      },

      interruptLanguage: () => languageRef.current?.interrupt?.(),

      isLanguageBusy: () => languageRef.current?.isBusy?.(),
      // ===== Agent 级调试 =====
      hear: async (text) => {
        return mikiAgent.hear(
          {
            text,
            messageId: "debug-agent",
          },
          {
            onThinkingStart: () => console.log("[debug hear] thinking"),
            onTextChunk: (chunk) => console.log("[debug hear] chunk:", chunk),
            onTextUpdate: (fullText) => console.log("[debug hear] full:", fullText),
            onDone: (finalText) => console.log("[debug hear] done:", finalText),
            onInterrupted: (partialText) =>
              console.log("[debug hear] interrupted:", partialText),
            onError: (err, partialText) =>
              console.error("[debug hear] error:", err, partialText),
          }
        );
      },

      interruptAgent: () => mikiAgent.interrupt(),

      isAgentBusy: () => mikiAgent.isBusy?.(),

      demoSmile: () => {
        const messageId = "debug-demo";
        characterOrchestrator.dispatch({
          type: "CHAT_START",
          messageId,
        });
        characterOrchestrator.dispatch({
          type: "CHAT_CONTROL_EMOTION",
          value: "smile",
        });
        characterOrchestrator.dispatch({
          type: "CHAT_CONTROL_MOTION",
          value: "excited",
        });
      },

      demoStop: () => {
        characterOrchestrator.dispatch({
          type: "CHAT_END",
          messageId: "debug-demo",
        });
      },
    };

    console.log("[mikiCharacterDebug] ready");

    return () => {
      delete window.mikiCharacterDebug;
    };
  }, [characterOrchestrator, mikiAgent]);

  useEffect(() => {
    return () => {
      streamRef.current?.close?.();
      stopLossPolling();
      mikiAgent?.interrupt?.();
    };
  }, [mikiAgent]);

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
            <Live2DStage modelKey={modelKey} />
          </main>

          <aside className="chat-column">
            <ChatPanel
              disabled={false}
              agent={mikiAgent}
            />
          </aside>
        </>
      )}

      {mode === AppMode.TRAINING && (
        <main className="training-stage-layout">
          <div className="training-stage-column">
            <Live2DStage modelKey={modelKey} />
          </div>

          <div className="training-info-column">
            <TrainingPanel training={training} />
          </div>
        </main>
      )}

      {mode === AppMode.BATTLE && (
        <main className="battle-layout">
          <aside className="battle-contact-column">
            <ContactPanel messages={battle.contactMessages} />
          </aside>

          <section className="battle-stage-column">
            <Live2DStage modelKey={modelKey} />
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