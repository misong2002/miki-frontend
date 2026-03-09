export async function startTraining(config) {
  const response = await fetch("/api/train/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(config),
  });

  if (!response.ok) {
    throw new Error(`Training start failed: ${response.status}`);
  }

  return await response.json();
}

export function connectTrainingStream(jobId, handlers) {
  const es = new EventSource(`/api/train/stream/${jobId}`);

  es.addEventListener("metric", (event) => {
    const data = JSON.parse(event.data);
    handlers.onMetric?.(data);
  });

  es.addEventListener("log", (event) => {
    const data = JSON.parse(event.data);
    handlers.onLog?.(data);
  });

  es.addEventListener("finish", (event) => {
    const data = JSON.parse(event.data);
    handlers.onFinish?.(data);
    es.close();
  });

  es.onerror = (err) => {
    handlers.onError?.(err);
  };

  return es;
}