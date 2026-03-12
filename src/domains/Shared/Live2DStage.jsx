import { useEffect, useRef } from "react";
import { Live2DManager } from "../miki_san/body/live2dManager";
import { live2dController } from "../miki_san/body/live2dController";

export default function Live2DStage({ modelKey }) {
  const containerRef = useRef(null);
  const managerRef = useRef(null);
  const initPromiseRef = useRef(null);

  useEffect(() => {
    let disposed = false;

    async function setup() {
      if (!containerRef.current) return;
      if (managerRef.current) return; // 防重复初始化

      const manager = new Live2DManager(containerRef.current);
      managerRef.current = manager;

      await manager.init();
      if (disposed) return;

      await manager.loadModel(modelKey);
    }

    setup().catch(console.error);

    return () => {
      disposed = true;
      managerRef.current?.destroy();
      managerRef.current = null;
    };
  }, []);

  useEffect(() => {
    async function switchModel() {
      if (!managerRef.current || !initPromiseRef.current) return;
      await initPromiseRef.current;
      if (!managerRef.current) return;
      await managerRef.current.switchTo(modelKey);
    }

    switchModel().catch((err) => {
      console.error("Live2D switch failed:", err);
    });
  }, [modelKey]);
  useEffect(() => {
    let disposed = false;

    async function setup() {
      if (!containerRef.current) return;

      if (!managerRef.current) {
        const manager = new Live2DManager(containerRef.current);
        managerRef.current = manager;
        await manager.init();
      }

      const manager = managerRef.current;
      await manager.loadModel(modelKey);

      if (disposed) return;

      live2dController.bindManager(manager);
    }

    setup().catch(console.error);

    return () => {
      disposed = true;
    };
  }, [modelKey]);
  return <div ref={containerRef} className="stage-panel" />;

}

