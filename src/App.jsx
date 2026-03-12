import { useEffect, useRef, useState } from "react";

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
  initialTrainingState,
  initialBattleState,
} from "./state/appStore";

import {
  startBattle,
  stopBattle,
  fetchLossData,
  fetchBattleStatus,
} from "./domains/Battle/services/battleService";
import { APP_CONFIG } from "./config";

import { createMikiAgent } from "./domains/miki_san/createMikiAgent";
import { createCharacterRuntimeBridge } from "./domains/miki_san/motor/characterRuntimeBridge";
import { createCharacterOrchestrator } from "./domains/miki_san/motor/characterOrchestrator";
import { createLanguageModule } from "./domains/miki_san/language/languageModule";
import { emotionEngine } from "./domains/miki_san/body/emotionEngine";
import { emotionMapper } from "./domains/miki_san/motor/emotionMapper";
import { motionMapper } from "./domains/miki_san/motor/motionMapper";


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

  useEffect(() => {
    async function bootstrapTrainingState() {
      try {
        const status = await fetchBattleStatus();

        console.log("[bootstrap] battle status:", status);

        if (status.running) {
          // 如果训练已经在运行
          setModelKey("magical");

          setBattle((prev) => ({
            ...prev,
            contactMessages: [
              "检测到已有训练任务仍在运行。",
              status.session?.mode === "cluster"
                ? `当前为集群任务：${status.session?.job_id ?? "unknown"}`
                : `当前为本地任务：PID ${status.session?.pid ?? "unknown"}`,
            ],
          }));

          setMode(AppMode.BATTLE);
        } else {
          // 没有训练任务
          setModelKey("normal");
          setMode(AppMode.CHAT);
        }
      } catch (err) {
        console.error("[bootstrap] failed to get battle status:", err);

        setModelKey("normal");
        setMode(AppMode.CHAT);
      }
    }

    bootstrapTrainingState();
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

  async function checkBattleStatus() {
    if (mode !== AppMode.BATTLE || battleExiting) return;

    try {
      const status = await fetchBattleStatus();

      if (!status.running) {
        console.log("[battle] training finished, auto return to chat");
        await handleTrainingFinishedExit();
      }
    } catch (err) {
      console.error("[battle] fetch status failed:", err);
    }
  }

  const pollingRef = useRef(false);

  function startLossPolling() {
    stopLossPolling();

    pollTimerRef.current = setInterval(async () => {
      if (pollingRef.current) return;
      pollingRef.current = true;

      try {
        await loadBattleLoss();
        await checkBattleStatus();
      } finally {
        pollingRef.current = false;
      }
    }, APP_CONFIG.lossPollIntervalMs);
  }

  function stopLossPolling() {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  async function handleEnterBattleMode(trainConfig) {
    if (mode !== AppMode.CHAT) return;

    setMode(AppMode.TRANSFORMING);

    let startResult = null;

    try {
      startResult = await startBattle(trainConfig);
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

  async function handleTrainingFinishedExit() {
    stopLossPolling();

    setBattle((prev) => ({
      ...prev,
      contactMessages: [
        "已取得悲叹之种。",
        "辛苦啦，一起回去吧。",
      ],
    }));

    setModelKey("normal");
    setBattleExiting(false);
    setMode(AppMode.CHAT);
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

      beginChat: (messageId = "debug-chat") =>
        characterOrchestrator.dispatch({
          type: "CHAT_BEGIN",
          messageId,
        }),

      startSpeaking: (messageId = "debug-chat") =>
        characterOrchestrator.dispatch({
          type: "CHAT_SPEAK_START",
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

      demoThink: (messageId = "debug-chat") => {
        characterOrchestrator.dispatch({
          type: "CHAT_BEGIN",
          messageId,
        });
      },

      demoSpeak: (messageId = "debug-chat") => {
        characterOrchestrator.dispatch({
          type: "CHAT_SPEAK_START",
          messageId,
        });
      },

      demoLine: (
        {
          messageId = "debug-chat",
          emotion = null,
          motion = null,
        } = {}
      ) => {
        characterOrchestrator.dispatch({
          type: "CHAT_BEGIN",
          messageId,
        });

        if (emotion) {
          characterOrchestrator.dispatch({
            type: "CHAT_CONTROL_EMOTION",
            value: emotion,
          });
        }

        if (motion) {
          characterOrchestrator.dispatch({
            type: "CHAT_CONTROL_MOTION",
            value: motion,
          });
        }

        characterOrchestrator.dispatch({
          type: "CHAT_SPEAK_START",
          messageId,
        });
      },
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