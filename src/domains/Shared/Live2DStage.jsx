import { useEffect, useRef } from "react";
import { Live2DManager } from "../miki_san/body/live2dManager";
import { live2dController } from "../miki_san/body/live2dController";

const DEFAULT_POSITION = { x: 0.5, y: 1.0 };
const DEFAULT_SCALE = 1.0;

export default function Live2DStage({
  modelKey,
  position = DEFAULT_POSITION,
  scale = DEFAULT_SCALE,
  onInteraction = null,
}) {
  const containerRef = useRef(null);
  const managerRef = useRef(null);
  const initPromiseRef = useRef(null);

  useEffect(() => {
    let disposed = false;

    async function setup() {
      if (!containerRef.current) return;

      if (!managerRef.current) {
        const manager = new Live2DManager(containerRef.current, {
          onInteraction,
        });
        managerRef.current = manager;

        initPromiseRef.current = manager.init();
        await initPromiseRef.current;

        if (disposed) return;

        live2dController.bindManager(manager);
      }

      const manager = managerRef.current;
      if (!manager) return;

      manager.setLayout({
        position,
        scale,
      });

      await manager.loadModel(modelKey);
    }

    setup().catch((err) => {
      console.error("[Live2DStage] setup failed:", err);
    });

    return () => {
      disposed = true;
      managerRef.current?.destroy();
      managerRef.current = null;
      initPromiseRef.current = null;
    };
  }, [onInteraction]);

  useEffect(() => {
    async function switchModel() {
      const manager = managerRef.current;
      const initPromise = initPromiseRef.current;

      if (!manager || !initPromise) return;

      await initPromise;

      if (!managerRef.current) return;

      await manager.switchTo(modelKey);
    }

    switchModel().catch((err) => {
      console.error("[Live2DStage] switch model failed:", err);
    });
  }, [modelKey]);

  useEffect(() => {
    const manager = managerRef.current;
    if (!manager) return;

    manager.setLayout({
      position,
      scale,
    });
  }, [position, scale]);

  return <div ref={containerRef} className="stage-panel" />;
}