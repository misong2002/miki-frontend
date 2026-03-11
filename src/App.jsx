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
import { createCharacterOrchestrator } from "./features/character/characterOrchestrator";
import { createCharacterRuntimeBridge } from "./features/character/characterRuntimeBridge";
import { emotionMapper } from "./features/character/emotionMapper";
import { motionMapper } from "./features/character/motionMapper";

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

  const characterOrchestrator = characterOrchestratorRef.current;

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

  // mode 变化时，同步给 orchestrator
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

  // 只暴露 orchestrator 级别的调试入口
  useEffect(() => {
    if (typeof window === "undefined") return;

    window.mikiCharacterDebug = {
      // ===== 状态 =====
      getState: () => characterOrchestrator.getState(),

      // ===== 原始事件入口 =====
      dispatch: (event) => characterOrchestrator.dispatch(event),

      // ===== chat 语义调试 =====
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

      // ===== 训练/战斗语义调试 =====
      setTraining: (status = "running", semantic = "focused") =>
        characterOrchestrator.dispatch({
          type: "TRAINING_STATUS",
          payload: { status, semantic },
        }),

      // ===== 用户活动 =====
      userActive: (source = "debug") =>
        characterOrchestrator.dispatch({
          type: "USER_ACTIVE",
          source,
        }),

      // ===== App mode 调试 =====
      setMode: (nextMode) =>
        characterOrchestrator.dispatch({
          type: "APP_MODE_CHANGED",
          mode: nextMode,
        }),

      // ===== 说话调试：也只走顶层事件 =====
      startSpeech: (messageId = "debug-chat") =>
        characterOrchestrator.dispatch({
          type: "CHAT_START",
          messageId,
        }),

      stopSpeech: (messageId = "debug-chat") =>
        characterOrchestrator.dispatch({
          type: "CHAT_END",
          messageId,
        }),

      // ===== 一键测试 =====
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
  }, [characterOrchestrator]);

  useEffect(() => {
    return () => {
      streamRef.current?.close?.();
      stopLossPolling();
    };
  }, []);

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
              characterOrchestrator={characterOrchestrator}
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