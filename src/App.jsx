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

  async function handleEnterBattleMode() {
    if (mode !== AppMode.CHAT) return;

    setMode(AppMode.TRANSFORMING);

    let startResult = null;

    try {
      startResult = await startBattle(params);
    } catch (err) {
      console.error(err);
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
          `魔女结界已启动：PID ${startResult?.pid ?? "unknown"}`,
          "...准备好了吗？这边就先顶上了。",
          "你那边盯好魔力波动，我来处理前线。",
          "站在我身后就好，正义的魔法少女会保护你哒！",
        ],
        lossData: result.data ?? [],
      }));
    } catch (err) {
      console.error(err);
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
    return () => {
      streamRef.current?.close?.();
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