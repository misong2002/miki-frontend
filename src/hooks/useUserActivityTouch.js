// miki-frontend/src/hooks/useUserActivityTouch.js

import { useEffect, useRef } from "react";

export function useUserActivityTouch({ appAgent, idleMs = 2000 } = {}) {
  const idleTimerRef = useRef(null);

  useEffect(() => {
    if (!appAgent?.notifyUserActivity) return;

    function clearIdleTimer() {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    }

    function scheduleIdle() {
      clearIdleTimer();

      if (!appAgent?.notifyUserIdle) return;

      idleTimerRef.current = window.setTimeout(() => {
        appAgent.notifyUserIdle("window_idle");
      }, idleMs);
    }

    function handleUserActivity() {
      appAgent.notifyUserActivity("window_activity");
      scheduleIdle();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        appAgent.notifyUserActivity("tab_visible");
        scheduleIdle();
      }
    }

    window.addEventListener("mousemove", handleUserActivity);
    window.addEventListener("keydown", handleUserActivity);
    window.addEventListener("pointerdown", handleUserActivity);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    scheduleIdle();

    return () => {
      window.removeEventListener("mousemove", handleUserActivity);
      window.removeEventListener("keydown", handleUserActivity);
      window.removeEventListener("pointerdown", handleUserActivity);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearIdleTimer();
    };
  }, [appAgent, idleMs]);
}