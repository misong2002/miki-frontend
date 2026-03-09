import { useEffect, useRef } from "react";
import { Live2DManager } from "../live2d/live2dManager";

export default function Live2DStage({ modelKey }) {
  const containerRef = useRef(null);
  const managerRef = useRef(null);
  const initPromiseRef = useRef(null);

  useEffect(() => {
    let disposed = false;

    async function setup() {
      if (!containerRef.current) return;

      const manager = new Live2DManager(containerRef.current);
      managerRef.current = manager;

      initPromiseRef.current = manager.init();
      await initPromiseRef.current;

      if (disposed) return;

      await manager.loadModel(modelKey);
    }

    setup().catch((err) => {
      console.error("Live2D setup failed:", err);
    });

    const onResize = () => {
      managerRef.current?.resize();
    };

    window.addEventListener("resize", onResize);

    return () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
      managerRef.current?.destroy();
      managerRef.current = null;
      initPromiseRef.current = null;
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

  return <div ref={containerRef} className="stage-panel" />;
}