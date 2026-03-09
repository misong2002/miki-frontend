import { useRef, useState } from "react";
import ChatPanel from "./components/ChatPanel";
import HyperParamPanel from "./components/HyperParamPanel";
import TrainingPanel from "./components/TrainingPanel";
import TransitionOverlay from "./components/TransitionOverlay";
import Live2DStage from "./components/Live2DStage";
import { AppMode, initialHyperParams, initialTrainingState } from "./state/appStore";
import { startTraining, connectTrainingStream } from "./services/trainingService";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function App() {
  const [mode, setMode] = useState(AppMode.CHAT);
  const [modelKey, setModelKey] = useState("normal");
  const [params, setParams] = useState(initialHyperParams);
  const [training, setTraining] = useState(initialTrainingState);
  const streamRef = useRef(null);

  async function handleStartTraining() {
    if (mode !== AppMode.CHAT) return;

    setMode(AppMode.TRANSFORMING);

    await delay(150);
    setModelKey("magical");
    await delay(300);

    let job;
    try {
      job = await startTraining(params);
    } catch (err) {
      setMode(AppMode.CHAT);
      setModelKey("normal");
      console.error(err);
      return;
    }

    setTraining((prev) => ({
      ...prev,
      jobId: job.job_id,
      status: "running",
      logs: [`Training started: ${job.job_id}`],
    }));

    streamRef.current = connectTrainingStream(job.job_id, {
      onMetric: (data) => {
        setTraining((prev) => ({
          ...prev,
          status: data.status ?? prev.status,
          epoch: data.epoch ?? prev.epoch,
          step: data.step ?? prev.step,
          loss: data.loss ?? prev.loss,
          lossHistory:
            data.loss != null ? [...prev.lossHistory, data.loss] : prev.lossHistory,
        }));
      },
      onLog: (data) => {
        setTraining((prev) => ({
          ...prev,
          logs: [...prev.logs, data.message ?? JSON.stringify(data)],
        }));
      },
      onFinish: (data) => {
        setTraining((prev) => ({
          ...prev,
          status: data.status ?? "finished",
          logs: [...prev.logs, "Training finished."],
        }));
      },
      onError: () => {
        setTraining((prev) => ({
          ...prev,
          status: "error",
          logs: [...prev.logs, "Training stream error."],
        }));
      },
    });

    setMode(AppMode.TRAINING);
  }

  return (
    <div className={`app-root mode-${mode}`}>
      <TransitionOverlay visible={mode === AppMode.TRANSFORMING} />

      {mode === AppMode.CHAT && (
        <>
          <aside className="param-column">
            <HyperParamPanel
              params={params}
              setParams={setParams}
              onStart={handleStartTraining}
              disabled={false}
            />
          </aside>

          <main className="stage-column">
            <Live2DStage modelKey={modelKey} />
          </main>

          <aside className="chat-column">
            <ChatPanel disabled={false} />
          </aside>
        </>
      )}

      {mode === AppMode.TRAINING && (
        <main className="training-stage-layout">
          <div className="training-stage-column">
            <Live2DStage modelKey={modelKey} />
          </div>
          <div className="training-info-column">
            <TrainingPanel training={training} />
          </div>
        </main>
      )}
    </div>
  );
}