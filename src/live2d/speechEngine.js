import { live2dController } from "./live2dController";

const DEBUG_SPEECH_ENGINE = true;

class SpeechEngine {
  constructor() {
    this.mode = "chat";
    this.current = {
      speaking: false,
      source: "typing",
    };

    this.listeners = new Set();
    this.mouthTimer = null;
    this.mouthPhase = 0;
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
      speaking: next,
      source,
    };

    live2dController.setSpeaking(next);

    if (next) {
      this.startMouthLoop();
    } else {
      this.stopMouthLoop();
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
    });

    return true;
  }

  startMouthLoop() {
    if (this.mouthTimer) return;

    this.mouthPhase = 0;
    this.mouthTimer = setInterval(() => {
      this.mouthPhase += 1;
      const pattern = [0.15, 0.55, 0.9, 0.35, 0.7, 0.1];
      const value = pattern[this.mouthPhase % pattern.length];
      live2dController.setMouthOpen(value);
    }, 90);
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
    live2dController.setMouthOpen(0);
    live2dController.setSpeaking(false);
    live2dController.interrupt();

    this.current = {
      speaking: false,
      source,
    };

    this.emit({
      type: "interrupt",
      source,
      state: { ...this.current },
    });

    return true;
  }

  reset() {
    this.stopMouthLoop();
    live2dController.setMouthOpen(0);
    live2dController.setSpeaking(false);

    this.current = {
      speaking: false,
      source: "typing",
    };

    this.emit({
      type: "speech_reset",
      state: { ...this.current },
    });

    this.log("RESET", { state: this.current });
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