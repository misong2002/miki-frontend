// src/hooks/useBattleController.js
import { useEffect, useMemo, useRef, useState } from "react";
import { APP_CONFIG } from "../config";
import {
  startBattle,
  stopBattle,
  fetchLossData,
  fetchBattleStatus,
} from "../domains/Battle/services/battleService";
import {
  makeContactMessage,
  normalizeContactMessages,
} from "../domains/Battle/utils/contactMessageUtils";
import { saveTrainingHistory } from "../domains/Battle/services/historyService";

async function trySaveTrainingHistory() {
  try {
    const result = await saveTrainingHistory("config/train_config.json");
    console.log("[battle] save history success:", result);
    return true;
  } catch (err) {
    console.error("[battle] save history failed:", err);
    return false;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSessionKey(session) {
  if (!session) return null;

  if (session.job_id != null) {
    return `cluster:${session.job_id}`;
  }

  if (session.pid != null) {
    return `local:${session.pid}`;
  }

  return null;
}

export function useBattleController({
  battleAgent,
  appAgent,
  stageAgent,
  mode,
  setMode,
  appModeEnum,
  initialBattleState,
  defaultStageProps,
  magicalStageProps,
}) {
  const [battle, setBattle] = useState(() => ({
    ...initialBattleState,
    contactMessages: normalizeContactMessages(
      initialBattleState.contactMessages
    ),
  }));

  const [battleExiting, setBattleExiting] = useState(false);

  const pollTimerRef = useRef(null);
  const pollingRef = useRef(false);
  const modeRef = useRef(mode);
  const battleExitingRef = useRef(battleExiting);

  /**
   * 当前活跃 session 的 key。
   * 用来在“检测到 session 关闭”时只保存一次 history，
   * 避免轮询阶段重复触发。
   */
  const activeSessionKeyRef = useRef(null);
  const savedClosedSessionKeyRef = useRef(null);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    battleExitingRef.current = battleExiting;
  }, [battleExiting]);

  const resetBattleState = useMemo(() => {
    return () => ({
      ...initialBattleState,
      contactMessages: normalizeContactMessages(
        initialBattleState.contactMessages
      ),
    });
  }, [initialBattleState]);

  function markSessionRunning(session) {
    const nextKey = getSessionKey(session);
    if (!nextKey) return;

    if (activeSessionKeyRef.current !== nextKey) {
      activeSessionKeyRef.current = nextKey;
      savedClosedSessionKeyRef.current = null;
    }
  }

  async function saveHistoryOnSessionClosedOnce(sessionKey = null) {
    const key = sessionKey ?? activeSessionKeyRef.current ?? "__unknown_session__";

    if (savedClosedSessionKeyRef.current === key) {
      return false;
    }

    const ok = await trySaveTrainingHistory();

    if (ok) {
      savedClosedSessionKeyRef.current = key;
    }

    return ok;
  }

  async function loadBattleLoss() {
    try {
      const result = await fetchLossData();
      const lossData = result.data ?? [];

      setBattle((prev) => ({
        ...prev,
        lossData,
        lossMeta: result.meta ?? null,
      }));

      return {
        lossData,
        lossMeta: result.meta ?? null,
      };
    } catch (err) {
      console.error("[battle] fetch loss failed:", err);
      return {
        lossData: [],
        lossMeta: null,
      };
    }
  }

  function stopLossPolling() {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  async function handleBattleFinishedExit() {
    setBattleExiting(true);
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

    stageAgent?.setStageProps?.(defaultStageProps);

    setBattle(resetBattleState());
    activeSessionKeyRef.current = null;
    setBattleExiting(false);

    appAgent?.setMode?.(appModeEnum.CHAT);
    setMode(appModeEnum.CHAT);
  }

  async function checkBattleStatus() {
    if (
      modeRef.current !== appModeEnum.BATTLE ||
      battleExitingRef.current
    ) {
      return false;
    }

    try {
      const status = await fetchBattleStatus();

      if (status.running) {
        markSessionRunning(status.session);
        return true;
      }

      /**
       * 这里是本次改动的核心：
       * 只要检测到 session 已关闭，就立刻自动保存 history，
       * 不再把 save_history 绑定到 AppMode 切换本身。
       */
      await saveHistoryOnSessionClosedOnce();
      await handleBattleFinishedExit();
      return false;
    } catch (err) {
      console.error("[battle] fetch status failed:", err);
      return true;
    }
  }

  function startLossPolling() {
    stopLossPolling();

    pollTimerRef.current = setInterval(async () => {
      if (pollingRef.current) return;
      pollingRef.current = true;

      try {
        const { lossData } = await loadBattleLoss();
        const stillRunning = await checkBattleStatus();

        if (!stillRunning) return;

        await battleAgent?.submitLossData?.(lossData);
      } finally {
        pollingRef.current = false;
      }
    }, APP_CONFIG.lossPollIntervalMs);
  }

  async function handleEnterBattleMode(trainConfig) {
    if (modeRef.current !== appModeEnum.CHAT) return;

    appAgent?.setMode?.(appModeEnum.TRANSFORMING);
    setMode(appModeEnum.TRANSFORMING);

    let startResult = null;

    try {
      startResult = await startBattle(trainConfig);
    } catch (err) {
      console.error("[battle] startBattle failed:", err);
      stageAgent?.setStageProps?.(defaultStageProps);
      appAgent?.setMode?.(appModeEnum.CHAT);
      setMode(appModeEnum.CHAT);
      return;
    }

    markSessionRunning({
      job_id: startResult?.result?.job_id ?? null,
      pid: startResult?.result?.pid ?? startResult?.pid ?? null,
    });

    await delay(150);
    stageAgent?.setStageProps?.(magicalStageProps);
    await delay(350);

    try {
      const result = await fetchLossData();

      const pidOrJob =
        startResult?.result?.job_id != null
          ? `JOB ${startResult.result.job_id}`
          : `PID ${startResult?.result?.pid ?? startResult?.pid ?? "unknown"}`;

          setBattle((prev) => ({
            ...prev,
            contactMessages: [
              ...prev.contactMessages,
              makeContactMessage({ comment: "准备好了吗？要进入结界了！" }),
              makeContactMessage({ comment: `已进入魔女结界：${pidOrJob}` }),
              makeContactMessage({
                comment: "站在我身后就好，帮我盯着魔力波动！",
              }),
            ].slice(-100),
            lossData: result.data ?? [],
            lossMeta: result.meta ?? null,
          }));
    } catch (err) {
      console.error("[battle] fetchLossData failed:", err);

      setBattle((prev) => ({
        ...prev,
        contactMessages: [
          makeContactMessage({
            comment: "通信接通，但 loss 数据读取失败了。",
          }),
          makeContactMessage({
            comment: `错误：${err.message}`,
          }),
        ],
        lossData: [],
        lossMeta: null,
      }));
    }

    appAgent?.setMode?.(appModeEnum.BATTLE);
    setMode(appModeEnum.BATTLE);
  }

  async function handleForceExitBattle() {
    if (
      modeRef.current !== appModeEnum.BATTLE ||
      battleExitingRef.current
    ) {
      return;
    }

    setBattleExiting(true);
    stopLossPolling();

    try {
      await stopBattle();
    } catch (err) {
      console.error("[battle] stop failed:", err);
    }

    /**
     * 手动退出本质上也是 session 被关闭。
     * 这里同样按“检测到关闭后保存一次”的语义处理。
     */
    await saveHistoryOnSessionClosedOnce();

    stageAgent?.setStageProps?.(defaultStageProps);

    setBattle(resetBattleState());
    activeSessionKeyRef.current = null;
    appAgent?.setMode?.(appModeEnum.CHAT);
    setMode(appModeEnum.CHAT);
    setBattleExiting(false);
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrapBattleState() {
      try {
        const status = await fetchBattleStatus();
        if (cancelled) return;

        if (status.running) {
          markSessionRunning(status.session);
          stageAgent?.setStageProps?.(magicalStageProps);

          const introMessages = [
            makeContactMessage({
              comment: "你回来啦？不要在结界里乱跑哦！",
            }),
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

          appAgent?.setMode?.(appModeEnum.BATTLE);
          setMode(appModeEnum.BATTLE);
        } else {
          stageAgent?.setStageProps?.(defaultStageProps);
          appAgent?.setMode?.(appModeEnum.CHAT);
          setMode(appModeEnum.CHAT);
        }
      } catch (err) {
        console.error("[bootstrap] failed to get battle status:", err);
        stageAgent?.setStageProps?.(defaultStageProps);
        appAgent?.setMode?.(appModeEnum.CHAT);
        setMode(appModeEnum.CHAT);
      }
    }

    bootstrapBattleState();

    return () => {
      cancelled = true;
    };
  }, [
    appAgent,
    stageAgent,
    setMode,
    appModeEnum,
    magicalStageProps,
    defaultStageProps,
  ]);

  useEffect(() => {
    if (!battleAgent?.subscribeContactFeed) return;

    const unregister = battleAgent.subscribeContactFeed((payload) => {
      if (!payload?.comment) return;
      if (payload.feature === "none") return;
      if (payload.feature === "normal") return;

      const msg = makeContactMessage(payload);

      setBattle((prev) => ({
        ...prev,
        contactMessages: [...prev.contactMessages, msg].slice(-100),
      }));
    });

    return () => {
      unregister?.();
    };
  }, [battleAgent]);

  useEffect(() => {
    appAgent?.setMode?.(mode);

    if (mode === appModeEnum.BATTLE) {
      loadBattleLoss();
      startLossPolling();
      battleAgent?.setTrainingSemantic?.("running", "normal");
    } else {
      stopLossPolling();
      battleAgent?.setTrainingSemantic?.("idle", "idle");
    }

    return () => {
      stopLossPolling();
    };
  }, [mode, battleAgent, appAgent, appModeEnum]);

  useEffect(() => {
    return () => {
      stopLossPolling();
      battleAgent?.interrupt?.();
    };
  }, [battleAgent]);

  return {
    battle,
    battleExiting,
    handleEnterBattleMode,
    handleForceExitBattle,
  };
}