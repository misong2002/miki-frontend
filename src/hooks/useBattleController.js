// src/hooks/useBattleController.js
import { useEffect, useMemo, useRef, useState } from "react";
import { APP_CONFIG } from "../config";
import {
  startBattle,
  stopBattle,
  fetchLossData,
  fetchBattleStatus,
  fetchTrainingLossSummaryPrompt,
  fetchTrainingLiveLog,
} from "../domains/Battle/services/battleService";
import {
  makeContactMessage,
  normalizeContactMessages,
} from "../domains/Battle/utils/contactMessageUtils";
import { saveTrainingHistory } from "../domains/Battle/services/historyService";
import { runHistoryPlot } from "../domains/Battle/services/historyToolService";

const INITIAL_BATTLE_STATUS_TIMEOUT_MS = 5000;
const BATTLE_CONTACT_CACHE_KEY = "miki.battle.contactCache.v1";

function loadCachedBattleContacts() {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(BATTLE_CONTACT_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    return {
      sessionKey:
        typeof parsed.sessionKey === "string" ? parsed.sessionKey : null,
      messages: normalizeContactMessages(parsed.messages),
    };
  } catch (err) {
    console.warn("[battle/cache] failed to load contact cache:", err);
    return null;
  }
}

function saveCachedBattleContacts(sessionKey, messages) {
  if (
    !sessionKey ||
    typeof window === "undefined" ||
    !window.localStorage
  ) {
    return;
  }

  try {
    window.localStorage.setItem(
      BATTLE_CONTACT_CACHE_KEY,
      JSON.stringify({
        sessionKey,
        messages: normalizeContactMessages(messages).slice(-100),
      })
    );
  } catch (err) {
    console.warn("[battle/cache] failed to save contact cache:", err);
  }
}

function clearCachedBattleContacts() {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.removeItem(BATTLE_CONTACT_CACHE_KEY);
  } catch (err) {
    console.warn("[battle/cache] failed to clear contact cache:", err);
  }
}

function extractHistorySessionId(result) {
  const directSession = String(
    result?.history_session || result?.session_id || ""
  ).trim();
  if (/^\d{8}_\d{6}\/(?:epoch\d+\(model on epoch \d+\)(?:_\d+)?|\d+)$/.test(directSession)) {
    return directSession;
  }

  const text = [result?.stdout_preview, result?.message]
    .filter(Boolean)
    .join("\n");
  const leafMatches = [
    ...text.matchAll(
      /(\d{8}_\d{6}\/(?:epoch\d+\(model on epoch \d+\)(?:_\d+)?|\d+))/g
    ),
  ];
  if (leafMatches.length > 0) {
    return leafMatches.at(-1)?.[1] ?? "";
  }

  if (/^\d{8}_\d{6}$/.test(directSession)) {
    return directSession;
  }

  const timestampMatches = [...text.matchAll(/\b(\d{8}_\d{6})\b/g)];
  return timestampMatches.at(-1)?.[1] ?? "";
}

async function tryBuildTrainingSummaryPrompt() {
  try {
    const result = await fetchTrainingLossSummaryPrompt();
    return result?.has_prompt ? result.prompt ?? "" : "";
  } catch (err) {
    console.error("[battle] build training summary prompt failed:", err);
    return "";
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

function isTrainLiveLogBoundaryLine(line) {
  return line.startsWith("[DEBUG]") || line.startsWith("INFO:");
}

function formatSystemContactMessage(lines) {
  const message = lines.join("\n").trim();
  if (!message) return null;
  return `（战场信息：\n\`\`\`\n${message}\n\`\`\`\n）`;
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
  const [battleBootstrapResolved, setBattleBootstrapResolved] = useState(false);
  const [historyAction, setHistoryAction] = useState("");
  const [historyMessage, setHistoryMessage] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [historyStatusKind, setHistoryStatusKind] = useState("idle");
  const [lastPlottedSessionId, setLastPlottedSessionId] = useState("");
  const [plotRefreshKey, setPlotRefreshKey] = useState(0);

  const pollTimerRef = useRef(null);
  const pollingRef = useRef(false);
  const modeRef = useRef(mode);
  const battleExitingRef = useRef(battleExiting);
  const trainLiveLogOffsetRef = useRef(null);
  const trainLiveLogBufferRef = useRef([]);

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

  function resetHistoryUiState() {
    setHistoryAction("");
    setHistoryMessage("");
    setHistoryError("");
    setHistoryStatusKind("idle");
    setLastPlottedSessionId("");
    setPlotRefreshKey(0);
  }

  function applyHistoryUiSuccess({
    sessionId = "",
    message = "",
    refreshPlot = false,
  } = {}) {
    setHistoryError("");
    setHistoryStatusKind("success");
    setHistoryMessage(message);
    if (sessionId) {
      setLastPlottedSessionId(sessionId);
    }
    if (refreshPlot) {
      setPlotRefreshKey((prev) => prev + 1);
    }
  }

  function applyHistoryUiError(errorMessage) {
    setHistoryError(errorMessage || "failed to save history and plot");
    setHistoryMessage("");
    setHistoryStatusKind("error");
  }

  function markSessionRunning(session) {
    const nextKey = getSessionKey(session);
    if (!nextKey) return nextKey;

    if (activeSessionKeyRef.current !== nextKey) {
      activeSessionKeyRef.current = nextKey;
      savedClosedSessionKeyRef.current = null;
    }

    return nextKey;
  }

  async function executeSaveHistoryAndPlot() {
    setHistoryAction("save-plot");
    setHistoryError("");
    setHistoryStatusKind("loading");
    setHistoryMessage("saving history...");

    const saveResult = await saveTrainingHistory("config/train_config.json");
    const sessionId = extractHistorySessionId(saveResult);

    if (!sessionId) {
      throw new Error("history saved but session_id was not returned");
    }

    if (saveResult?.should_plot === false) {
      applyHistoryUiSuccess({
        sessionId,
        message: `history saved: ${sessionId}; skipped plot because model epoch did not change`,
        refreshPlot: false,
      });
      return { ok: true, sessionId, plotted: false };
    }

    setHistoryMessage(`plotting ${sessionId}...`);
    const plotResult = await runHistoryPlot(sessionId);
    applyHistoryUiSuccess({
      sessionId,
      message: plotResult?.message || `plot finished: ${sessionId}`,
      refreshPlot: true,
    });
    return { ok: true, sessionId, plotted: true };
  }

  async function runSaveHistoryAndPlot() {
    if (historyAction) {
      return { ok: false, skipped: true };
    }

    try {
      return await executeSaveHistoryAndPlot();
    } catch (err) {
      console.error("[battle] save history / plot failed:", err);
      applyHistoryUiError(err.message || "failed to save history and plot");
      return { ok: false, error: err };
    } finally {
      setHistoryAction("");
    }
  }

  function consumeAutoHistoryResult(autoHistory) {
    if (!autoHistory || typeof autoHistory !== "object") return;

    const sessionId = extractHistorySessionId(autoHistory);
    const shouldPlot = autoHistory?.should_plot !== false;
    const plotOk = autoHistory?.plot?.ok === true;
    const plotSkipped = autoHistory?.plot?.skipped === true || shouldPlot === false;

    if (autoHistory?.ok !== true) {
      applyHistoryUiError(autoHistory?.error || "auto save_history failed");
      return;
    }

    if (shouldPlot && !plotOk) {
      applyHistoryUiError(autoHistory?.plot?.error || "auto plot failed");
      return;
    }

    if (plotSkipped) {
      applyHistoryUiSuccess({
        sessionId,
        message:
          autoHistory?.plot?.message ||
          (sessionId
            ? `history saved: ${sessionId}; skipped plot because model epoch did not change`
            : "history saved; skipped plot because model epoch did not change"),
        refreshPlot: false,
      });
      return;
    }

    applyHistoryUiSuccess({
      sessionId,
      message:
        autoHistory?.plot?.message ||
        autoHistory?.message ||
        (sessionId ? `plot finished: ${sessionId}` : "plot finished"),
      refreshPlot: Boolean(sessionId),
    });
  }

  async function saveHistoryOnSessionClosedOnce(sessionKey = null) {
    const key = sessionKey ?? activeSessionKeyRef.current ?? "__unknown_session__";

    if (savedClosedSessionKeyRef.current === key) {
      return false;
    }

    const result = await runSaveHistoryAndPlot();
    const ok = result?.ok === true;

    if (ok) {
      savedClosedSessionKeyRef.current = key;
    }

    return ok;
  }

  async function queueTrainingSummaryPromptIfAvailable() {
    const prompt = await tryBuildTrainingSummaryPrompt();
    if (!prompt) return false;

    appAgent?.queueTrainingSummaryPrompt?.(prompt);
    return true;
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

  function resetTrainingLiveLogState() {
    trainLiveLogOffsetRef.current = null;
    trainLiveLogBufferRef.current = [];
  }

  function flushTrainingLiveLogBuffer() {
    const comment = formatSystemContactMessage(trainLiveLogBufferRef.current);
    trainLiveLogBufferRef.current = [];

    if (!comment) return;

    setBattle((prev) => ({
      ...prev,
      contactMessages: [
        ...prev.contactMessages,
        makeContactMessage({ comment }),
      ].slice(-100),
    }));
  }

  async function pollTrainingLiveLog() {
    try {
      const result = await fetchTrainingLiveLog(trainLiveLogOffsetRef.current);

      if (result?.truncated) {
        trainLiveLogBufferRef.current = [];
      }

      if (Number.isFinite(result?.next_offset)) {
        trainLiveLogOffsetRef.current = result.next_offset;
      }

      consumeAutoHistoryResult(result?.auto_history);

      const lines = Array.isArray(result?.lines) ? result.lines : [];

      for (const line of lines) {
        if (isTrainLiveLogBoundaryLine(line)) {
          flushTrainingLiveLogBuffer();
          continue;
        }

        trainLiveLogBufferRef.current.push(line);
      }
    } catch (err) {
      console.error("[battle] fetch train live log failed:", err);
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

    clearCachedBattleContacts();
    setBattle(resetBattleState());
    activeSessionKeyRef.current = null;
    resetTrainingLiveLogState();
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
      await queueTrainingSummaryPromptIfAvailable();
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
        await pollTrainingLiveLog();
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

    resetHistoryUiState();
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

    const startedSessionKey = markSessionRunning(
      startResult?.session ?? {
        mode: startResult?.result?.job_id != null ? "cluster" : "local",
        job_id: startResult?.result?.job_id ?? null,
        pid: startResult?.result?.pid ?? startResult?.pid ?? null,
      }
    );

    if (startedSessionKey) {
      resetTrainingLiveLogState();
      clearCachedBattleContacts();
      console.log("[battle/cache] cleared cached contact messages for new session:", startedSessionKey);
    }

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
    await queueTrainingSummaryPromptIfAvailable();

    stageAgent?.setStageProps?.(defaultStageProps);

    clearCachedBattleContacts();
    setBattle(resetBattleState());
    activeSessionKeyRef.current = null;
    resetTrainingLiveLogState();
    appAgent?.setMode?.(appModeEnum.CHAT);
    setMode(appModeEnum.CHAT);
    setBattleExiting(false);
  }

  async function handleSaveHistoryAndPlot() {
    if (battleExitingRef.current || historyAction) {
      return;
    }

    await runSaveHistoryAndPlot();
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrapBattleState() {
      console.log("[battle/bootstrap] begin status sync", { modeAtBoot: modeRef.current });
      try {
        const status = await Promise.race([
          fetchBattleStatus(),
          new Promise((_, reject) => {
            window.setTimeout(() => {
              reject(new Error("battle status bootstrap timed out"));
            }, INITIAL_BATTLE_STATUS_TIMEOUT_MS);
          }),
        ]);
        if (cancelled) return;

        console.log("[battle/bootstrap] status response:", status);

        if (status.running) {
          console.log("[battle/bootstrap] active training session detected, entering battle mode");
          console.log("[battle/bootstrap] app mode -> BATTLE", { reason: "startup_active_session" });
          resetHistoryUiState();
          const sessionKey = markSessionRunning(status.session);
          resetTrainingLiveLogState();
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
          const cachedContacts = loadCachedBattleContacts();
          const restoredMessages =
            cachedContacts?.sessionKey === sessionKey &&
            cachedContacts.messages.length > 0
              ? cachedContacts.messages
              : introMessages;

          if (cachedContacts?.sessionKey === sessionKey) {
            console.log("[battle/cache] restored cached contact messages:", restoredMessages.length);
          }

          setBattle((prev) => ({
            ...prev,
            contactMessages: restoredMessages,
          }));

          appAgent?.setMode?.(appModeEnum.BATTLE);
          setMode(appModeEnum.BATTLE);
        } else {
          console.log("[battle/bootstrap] no active training session, entering chat mode");
          console.log("[battle/bootstrap] app mode -> CHAT", { reason: "startup_no_active_session" });
          const cachedContacts = loadCachedBattleContacts();

          if (cachedContacts?.sessionKey) {
            console.log("[battle/bootstrap] cached battle session ended while away:", {
              sessionKey: cachedContacts.sessionKey,
            });
            await saveHistoryOnSessionClosedOnce(cachedContacts.sessionKey);
            await queueTrainingSummaryPromptIfAvailable();
          }

          clearCachedBattleContacts();
          resetTrainingLiveLogState();
          stageAgent?.setStageProps?.(defaultStageProps);
          appAgent?.setMode?.(appModeEnum.CHAT);
          setMode(appModeEnum.CHAT);
        }

        if (!cancelled) {
          console.log("[battle/bootstrap] status sync resolved");
          console.log("[battle/bootstrap] resolved -> true");
          setBattleBootstrapResolved(true);
        }
      } catch (err) {
        console.error("[battle/bootstrap] failed to get battle status:", err);
        stageAgent?.setStageProps?.(defaultStageProps);
        appAgent?.setMode?.(appModeEnum.CHAT);
        setMode(appModeEnum.CHAT);
        if (!cancelled) {
          console.log("[battle/bootstrap] fallback to chat mode after status sync failure");
          console.log("[battle/bootstrap] app mode -> CHAT", { reason: "startup_status_sync_failed" });
          console.log("[battle/bootstrap] resolved -> true");
          setBattleBootstrapResolved(true);
        }
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
    const sessionKey = activeSessionKeyRef.current;
    if (!sessionKey) return;

    saveCachedBattleContacts(sessionKey, battle.contactMessages);
  }, [battle.contactMessages]);

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
    battleBootstrapResolved,
    historyAction,
    historyMessage,
    historyError,
    historyStatusKind,
    lastPlottedSessionId,
    plotRefreshKey,
    handleEnterBattleMode,
    handleForceExitBattle,
    handleSaveHistoryAndPlot,
  };
}
