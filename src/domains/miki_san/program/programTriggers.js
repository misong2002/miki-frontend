const CONFIG_INTENT_PATTERNS = [
  /(改|修改|调整|设置|设成|调成|换成|更新|降低|提高|增大|减小).{0,18}(参数|配置|config|lr|learning rate|batch|batch_size|rounds|epoch|hidden|layer|omega|seed|loss|queue|nodes|walltime)/i,
  /(参数|配置|config).{0,18}(改|修改|调整|设置|设成|调成|换成|更新)/i,
];

export function detectConfigChangeIntent(text = "") {
  const query = String(text || "").replace(/\s+/g, " ").trim();
  if (!query) {
    return {
      shouldInjectConfig: false,
      query: "",
    };
  }

  return {
    shouldInjectConfig: CONFIG_INTENT_PATTERNS.some((pattern) =>
      pattern.test(query)
    ),
    query,
  };
}
