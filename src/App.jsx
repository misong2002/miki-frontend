// src/App.jsx

import { useEffect, useRef, useState } from "react";
import { selectMessagesForUI } from "./domains/miki_san/memory";
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function makeContactMessage({ comment, epoch = null, timestamp = Date.now() }) {
  return {
    id: `contact-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    content: comment,
    createdAt: timestamp,
    epoch,
  };
}

function normalizeContactMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .map((msg, index) => {
      if (typeof msg === "string") {
        return {
          id: `contact-init-${Date.now()}-${index}`,
          content: msg,
          createdAt: Date.now(),
          epoch: null,
        };
      }

      if (msg && typeof msg === "object") {
        return {
          id:
            msg.id ??
            `contact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          content: msg.content ?? "",
          createdAt: msg.createdAt ?? Date.now(),
          epoch: msg.epoch ?? null,
        };
      }

      return null;
    })
    .filter(Boolean);
}

function buildFallbackChatMessages() {
  return [
    {
      id: "welcome",
      role: "assistant",
      content:
        "久等了！这里是正义的魔法少女——美树沙耶香！快开始今天的魔女狩猎吧！",
      createdAt: Date.now(),
    },
  ];
}

function getBootChatMessages() {
  const restoredMessages = selectMessagesForUI(50);
  return restoredMessages.length > 0
    ? restoredMessages
    : buildFallbackChatMessages();
}

/**
 * 把后端返回的 loss 数据标准化成 memory 里统一的点格式。
 */
function normalizeLossPoint(item, index) {
  if (typeof item === "number") {
    return { step: index, value: item, wallTime: null };
  }

  if (item && typeof item === "object") {
    return {
      step: item.epoch ?? item.step ?? index,
      value: item.loss ?? item.value ?? 0,
      wallTime: item.timestamp ?? null,
    };
  }

  return { step: index, value: 0, wallTime: null };
}

/**
 * 等间距下采样。
 * 用于保留一条全局稀疏曲线，避免存太多点。
 */
function downsampleEvenly(points, maxPoints) {
  if (!Array.isArray(points) || points.length <= maxPoints) {
    return points ?? [];
  }

  const result = [];
  const step = (points.length - 1) / (maxPoints - 1);

  for (let i = 0; i < maxPoints; i += 1) {
    const idx = Math.round(i * step);
    result.push(points[idx]);
  }

  return result;
}

/**
 * 为 memory 构造两种分辨率的 loss 快照。
 */
function buildLossMemorySnapshot(lossData) {
  const normalized = (lossData ?? []).map(normalizeLossPoint);

  const recentDense = normalized.slice(-200);
  const globalSparse = downsampleEvenly(normalized, 800);

  return {
    recentDense,
    globalSparse,
  };
}

export default function App() {
  const [mode, setMode] = useState(AppMode.CHAT);
  const [params, setParams] = useState(initialHyperParams);
  const [training, setTraining] = useState(initialTrainingState);
  const [battle, setBattle] = useState({
    ...initialBattleState,
    contactMessages: normalizeContactMessages(initialBattleState.contactMessages),
  });
  const [battleExiting, setBattleExiting] = useState(false);
  const [stageProps, setStageProps] = useState(DEFAULT_STAGE_PROPS);

  const [chatBootReady, setChatBootReady] = useState(false);
  const [initialChatMessages, setInitialChatMessages] = useState([]);

  const streamRef = useRef(null);
  const pollTimerRef = useRef(null);
  const pollingRef = useRef(false);
  const mikiAgentRef = useRef(null);
  const trainingRunRef = useRef(null);

  if (!mikiAgentRef.current) {
    mikiAgentRef.current = createMikiAgent({
      onExternalityChange: (nextStageProps) => {
        setStageProps(nextStageProps);
      },
    });
  }

  const mikiAgent = mikiAgentRef.current;

  useEffect(() => {
    let cancelled = false;

    async function bootstrapChatMemory() {
      try {
        if (mikiAgent?.bootRemindPromise) {
          await mikiAgent.bootRemindPromise;
        }
      } catch (err) {
        console.warn("[App] bootRemindPromise failed:", err);
      } finally {
        if (cancelled) return;

        const restoredMessages = getBootChatMessages();
        setInitialChatMessages(restoredMessages);
        setChatBootReady(true);
      }
    }

    bootstrapChatMemory();

    return () => {
      cancelled = true;
    };
  }, [mikiAgent]);

  async function loadBattleLoss() {
    try {
      const result = await fetchLossData();
      const lossData = result.data ?? [];

      setBattle((prev) => ({
        ...prev,
        lossData,
        lossMeta: result.meta ?? null,
      }));

      return { lossData };
    } catch (err) {
      console.error("[battle] fetch loss failed:", err);
      return { lossData: [] };
    }
  }

  async function handleBattleFinishedExit() {
    if (trainingRunRef.current?.id && mikiAgent.memory?.endTrainingRun) {
      try {
        mikiAgent.memory.endTrainingRun(trainingRunRef.current.id, "finished");
      } catch (err) {
        console.warn("[battle] endTrainingRun(finished) failed:", err);
      } finally {
        trainingRunRef.current = null;
      }
    }

    stopLossPolling();

    setBattle((prev) => ({
      ...prev,
      contactMessages: [
        ...prev.contactMessages,
        makeContactMessage({
          comment: "已取得悲叹之种。辛苦啦，一起回去吧。",
        }),
      ].slice(-100),
    }));

    await delay(800);

    mikiAgent.externality.patch(DEFAULT_STAGE_PROPS);

    setBattle({
      ...initialBattleState,
      contactMessages: normalizeContactMessages(initialBattleState.contactMessages),
    });
    setBattleExiting(false);
    setMode(AppMode.CHAT);
  }

  async function checkBattleStatus() {
    if (mode !== AppMode.BATTLE || battleExiting) return;

    try {
      const status = await fetchBattleStatus();

      if (!status.running) {
        await handleBattleFinishedExit();
      }
    } catch (err) {
      console.error("[battle] fetch status failed:", err);
    }
  }

  function startLossPolling() {
    stopLossPolling();

    pollTimerRef.current = setInterval(async () => {
      if (pollingRef.current) return;
      pollingRef.current = true;

      try {
        const { lossData } = await loadBattleLoss();
        await checkBattleStatus();

        if (trainingRunRef.current?.id && mikiAgent.memory?.saveLossSeries) {
          try {
            const snapshot = buildLossMemorySnapshot(lossData);
            mikiAgent.memory.saveLossSeries(trainingRunRef.current.id, snapshot);
          } catch (err) {
            console.warn("[battle] saveLossSeries failed:", err);
          }
        }

        await mikiAgent.onLossUpdate?.(lossData);
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

      if (mikiAgent.memory?.startTrainingRun) {
        try {
          trainingRunRef.current = mikiAgent.memory.startTrainingRun({
            config: trainConfig,
            modelName: trainConfig?.modelName ?? null,
            dataset: trainConfig?.dataset ?? null,
          });
        } catch (err) {
          console.warn("[battle] startTrainingRun failed:", err);
          trainingRunRef.current = null;
        }
      }
    } catch (err) {
      console.error("[battle] startBattle failed:", err);
      mikiAgent.externality.patch(DEFAULT_STAGE_PROPS);
      setMode(AppMode.CHAT);
      return;
    }

    await delay(150);
    mikiAgent.externality.patch(MAGICAL_STAGE_PROPS);
    await delay(350);

    try {
      const result = await fetchLossData();

      const pidOrJob =
        startResult?.result?.job_id
          ? `JOB ${startResult.result.job_id}`
          : `PID ${startResult?.result?.pid ?? startResult?.pid ?? "unknown"}`;

      setBattle((prev) => ({
        ...prev,
        contactMessages: [
          makeContactMessage({ comment: "准备好了吗？要进入结界了！" }),
          makeContactMessage({ comment: `已进入魔女结界：${pidOrJob}` }),
          makeContactMessage({ comment: "站在我身后就好，帮我盯着魔力波动！" }),
        ],
        lossData: result.data ?? [],
        lossMeta: result.meta ?? null,
      }));
    } catch (err) {
      console.error("[battle] fetchLossData failed:", err);

      setBattle((prev) => ({
        ...prev,
        contactMessages: [
          makeContactMessage({ comment: "通信接通，但 loss 数据读取失败了。" }),
          makeContactMessage({ comment: `错误：${err.message}` }),
        ],
        lossData: [],
        lossMeta: null,
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

    if (trainingRunRef.current?.id && mikiAgent.memory?.endTrainingRun) {
      try {
        mikiAgent.memory.endTrainingRun(trainingRunRef.current.id, "stopped");
      } catch (err) {
        console.warn("[battle] endTrainingRun(stopped) failed:", err);
      } finally {
        trainingRunRef.current = null;
      }
    }

    mikiAgent.externality.patch(DEFAULT_STAGE_PROPS);

    setBattle({
      ...initialBattleState,
      contactMessages: normalizeContactMessages(initialBattleState.contactMessages),
    });
    setMode(AppMode.CHAT);
    setBattleExiting(false);
  }

  /**
   * 用户活动 -> touch memory。
   * 这一步对 wake cycle 很关键。
   */
  useEffect(() => {
    function handleUserActivity() {
      mikiAgent.setUserActive("window_activity");
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        mikiAgent.setUserActive("tab_visible");
      }
    }

    window.addEventListener("mousemove", handleUserActivity);
    window.addEventListener("keydown", handleUserActivity);
    window.addEventListener("pointerdown", handleUserActivity);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("mousemove", handleUserActivity);
      window.removeEventListener("keydown", handleUserActivity);
      window.removeEventListener("pointerdown", handleUserActivity);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [mikiAgent]);

  useEffect(() => {
    async function bootstrapBattleState() {
      try {
        const status = await fetchBattleStatus();

        if (status.running) {
          mikiAgent.externality.patch(MAGICAL_STAGE_PROPS);

          const introMessages = [
            makeContactMessage({ comment: "你回来啦？不要在结界里乱跑哦！" }),
            makeContactMessage({
              comment:
                status.session?.mode === "cluster"
                  ? `当前为集群任务：${status.session?.job_id ?? "unknown"}`
                  : `当前为本地任务：PID ${status.session?.pid ?? "unknown"}`,
            }),
          ];

          setBattle((prev) => ({
            ...prev,
            contactMessages: introMessages,
          }));

          setMode(AppMode.BATTLE);
        } else {
          mikiAgent.externality.patch(DEFAULT_STAGE_PROPS);
          setMode(AppMode.CHAT);
        }
      } catch (err) {
        console.error("[bootstrap] failed to get battle status:", err);
        mikiAgent.externality.patch(DEFAULT_STAGE_PROPS);
        setMode(AppMode.CHAT);
      }
    }

    bootstrapBattleState();
  }, [mikiAgent]);

  useEffect(() => {
    if (!mikiAgent?.registerContactCallback) return;

    mikiAgent.registerContactCallback((payload) => {
      if (!payload?.comment) return;
      if (payload.feature === "none") return;
      if (payload.feature === "normal") return;

      const msg = makeContactMessage(payload);

      setBattle((prev) => ({
        ...prev,
        contactMessages: [...prev.contactMessages, msg].slice(-100),
      }));
    });
  }, [mikiAgent]);

  useEffect(() => {
    mikiAgent.setAppMode(mode);

    if (mode === AppMode.BATTLE) {
      loadBattleLoss();
      startLossPolling();
      mikiAgent.setTrainingStatus("running", "normal");
      setTraining((prev) => ({
        ...prev,
        status: "running",
      }));
    } else {
      stopLossPolling();
      mikiAgent.setTrainingStatus("idle", "idle");
      setTraining((prev) => ({
        ...prev,
        status: "idle",
      }));
    }

    return () => {
      stopLossPolling();
    };
  }, [mode, mikiAgent]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    window.mikiCharacterDebug = mikiAgent.getDebugAPI();

    return () => {
      delete window.mikiCharacterDebug;
    };
  }, [mikiAgent]);

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
            <Live2DStage
              modelKey={stageProps.modelKey}
              position={stageProps.position}
              scale={stageProps.scale}
            />
          </main>

          <aside className="chat-column">
            {chatBootReady ? (
              <ChatPanel
                disabled={false}
                agent={mikiAgent}
                initialMessages={initialChatMessages}
              />
            ) : (
              <div className="chat-boot-loading">正在恢复对话记忆……</div>
            )}
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