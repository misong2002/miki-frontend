export function normalizeLossPoint(item, index) {
  if (typeof item === "number") {
    return { step: index, value: item, wallTime: null };
  }

  if (item && typeof item === "object") {
    return {
      step: item.epoch ?? item.step ?? index,
      value: item.loss ?? item.value ?? 0,
      wallTime: item.timestamp ?? null,
    };
  }

  return { step: index, value: 0, wallTime: null };
}

export function downsampleEvenly(points, maxPoints) {
  if (!Array.isArray(points) || points.length <= maxPoints) {
    return points ?? [];
  }

  if (maxPoints <= 1) {
    return [points[points.length - 1]];
  }

  const result = [];
  const step = (points.length - 1) / (maxPoints - 1);

  for (let i = 0; i < maxPoints; i += 1) {
    const idx = Math.round(i * step);
    result.push(points[idx]);
  }

  return result;
}

export function buildLossMemorySnapshot(lossData) {
  const normalized = (lossData ?? []).map(normalizeLossPoint);
  const recentDense = normalized.slice(-200);
  const globalSparse = downsampleEvenly(normalized, 800);

  return {
    recentDense,
    globalSparse,
  };
}