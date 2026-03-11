export function pickIdleMotion(state) {
  if (state?.appMode === "battle") {
    return "assertive";
  }

  if (state?.appMode === "transforming") {
    return "excited";
  }

  return "idle_default";
}