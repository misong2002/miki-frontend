import { useEffect } from "react";

export function useUserActivityTouch({ appAgent } = {}) {
  useEffect(() => {
    if (!appAgent?.notifyUserActivity) return;

    function handleUserActivity() {
      appAgent.notifyUserActivity("window_activity");
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        appAgent.notifyUserActivity("tab_visible");
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
  }, [appAgent]);
}