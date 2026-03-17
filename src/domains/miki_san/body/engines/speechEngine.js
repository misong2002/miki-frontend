import { live2dController } from "../live2dController";

const DEBUG_SPEECH_ENGINE = true;

class SpeechEngine {
  constructor() {
    this.mode = "chat";

    this.current = {
      speaking: false,
      source: "typing",
      mouthOpen: 0,
    };

    this.listeners = new Set();
    this.mouthTimer = null;
    this.mouthPhase = 0;
    this.mouthIntervalMs = 16;

    this.pattern = [
      0.08, 0.12, 0.16, 0.2, 0.24,
      0.28, 0.34, 0.4, 0.46, 0.52, 0.58,
      0.62, 0.68, 0.74, 0.8, 0.86,
      0.92, 0.86, 0.8, 0.74, 0.68, 0.62,
      0.55, 0.48, 0.42, 0.36, 0.3, 0.26,
      0.22, 0.18, 0.14, 0.1, 0.06,
    ];
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event) {
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch (err) {
        console.error("[SpeechEngine] listener error:", err);
      }
    }
  }

  setMode(mode) {
    this.mode = mode;
  }

  setSpeaking(active, options = {}) {
    const next = !!active;
    const source = options.source ?? "typing";

    if (this.current.speaking === next) {
      return false;
    }

    this.current = {
      ...this.current,
      speaking: next,
      source,
    };

    const controllerApplied = live2dController.setSpeaking(next) === true;

    if (next) {
      this.startMouthLoop();
    } else {
      this.stopMouthLoop();

      this.current = {
        ...this.current,
        speaking: false,
        mouthOpen: 0,
      };

      live2dController.setMouthOpen(0);
    }

    this.emit({
      type: "speaking",
      active: next,
      source,
      state: { ...this.current },
    });

    this.log("SET_SPEAKING", {
      active: next,
      source,
      controllerApplied,
    });

    return true;
  }

  startMouthLoop() {
    if (this.mouthTimer) return;

    this.mouthPhase = 0;
    this.stepMouth();

    this.mouthTimer = setInterval(() => {
      this.stepMouth();
    }, this.mouthIntervalMs);
  }

  stepMouth() {
    if (!this.current.speaking) return;

    this.mouthPhase += 1;

    const base = this.pattern[this.mouthPhase % this.pattern.length];
    const jitter = (Math.random() - 0.5) * 0.08;
    const value = Math.max(0, Math.min(1, base + jitter));

    this.current = {
      ...this.current,
      mouthOpen: value,
    };

    /**
     * 这里只更新 controller 持有的目标值。
     * 真正的“持续覆盖”由 live2dManager 的 ticker 完成。
     */
    live2dController.setMouthOpen(value);
  }

  stopMouthLoop() {
    if (this.mouthTimer) {
      clearInterval(this.mouthTimer);
      this.mouthTimer = null;
    }
  }

  interrupt(options = {}) {
    const source = options.source ?? "interrupt";

    this.log("INTERRUPT", {
      source,
      current: this.current,
    });

    this.stopMouthLoop();

    this.current = {
      speaking: false,
      source,
      mouthOpen: 0,
    };

    live2dController.setMouthOpen(0);
    live2dController.setSpeaking(false);
    live2dController.interrupt();

    this.emit({
      type: "interrupt",
      source,
      state: { ...this.current },
    });

    return true;
  }

  reset() {
    this.stopMouthLoop();

    this.current = {
      speaking: false,
      source: "typing",
      mouthOpen: 0,
    };

    live2dController.setMouthOpen(0);
    live2dController.setSpeaking(false);

    this.emit({
      type: "speech_reset",
      state: { ...this.current },
    });

    this.log("RESET", { state: this.current });

    return true;
  }

  log(type, payload) {
    if (!DEBUG_SPEECH_ENGINE) return;

    const time = new Date().toLocaleTimeString();
    console.log(
      `%c[SpeechEngine ${type}]`,
      "color:#17a34a;font-weight:bold",
      time,
      payload
    );
  }
}

export const speechEngine = new SpeechEngine();