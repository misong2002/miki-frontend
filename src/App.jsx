import { useEffect, useRef, useState } from "react";
import ChatPanel from "./components/ChatPanel";
import HyperParamPanel from "./components/HyperParamPanel";
import TrainingPanel from "./components/TrainingPanel";
import TransitionOverlay from "./components/TransitionOverlay";
import Live2DStage from "./components/Live2DStage";
import ContactPanel from "./components/ContactPanel";
import BattlePanel from "./components/BattlePanel";
import {
  AppMode,
  initialHyperParams,
  initialTrainingState,
  initialBattleState,
} from "./state/appStore";
import { connectTrainingStream } from "./services/trainingService";
import { startBattle, stopBattle, fetchLossData } from "./services/battleService";
import { APP_CONFIG } from "./config";

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
          "通信接通。现在开始进入战斗界面。",
          "我会继续盯着前线，你负责看右边的 loss。",
          `战斗脚本已启动：PID ${startResult?.pid ?? "unknown"}`,
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
      console.error("stop battle failed:", err);
    }

    setModelKey("normal");
    setBattle(initialBattleState);
    setMode(AppMode.CHAT);
    setBattleExiting(false);
  }

  useEffect(() => {
    if (mode === AppMode.BATTLE) {
      // 先立即拉一次，保证进入时就刷新
      loadBattleLoss();
      // 再开始轮询
      startLossPolling();
    } else {
      stopLossPolling();
    }

    return () => {
      stopLossPolling();
    };
  }, [mode]);

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
            <ChatPanel disabled={false} />
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
    </div>
  );
}