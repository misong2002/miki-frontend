function asJson(value) {
  return JSON.stringify(value, null, 2);
}

function formatToolResult(item) {
  const { name, result } = item;

  if (name === "web_search") {
    return `[web_search]\n${asJson({
      query: result?.query,
      provider: result?.provider,
      summary: result?.summary,
      results: result?.results,
    })}`;
  }

  if (name === "read_document") {
    return `[read_document]\n${asJson({
      source: result?.source,
      result: result?.result,
      raw_text_preview: result?.raw_text_preview,
    })}`;
  }

  if (name === "code_search") {
    return `[code_search]\n${asJson({
      query: result?.query,
      path_matches: result?.path_matches,
      results: result?.results,
    })}`;
  }

  if (name === "code_read") {
    const content = String(result?.content || "");
    return `[code_read]\n${asJson({
      path: result?.path,
      size: result?.size,
      fuzzy_match: result?.fuzzy_match,
      content: content.length > 36000 ? `${content.slice(0, 36000)}\n...<truncated>` : content,
    })}`;
  }

  if (name === "code_list") {
    return `[code_list]\n${asJson({
      path: result?.path,
      items: result?.items,
      truncated: result?.truncated,
    })}`;
  }

  if (name === "config_context") {
    return `[config_context]\n${asJson({
      config: result?.config,
      available_models: result?.available_models,
      default_model: result?.default_model,
    })}`;
  }

  if (name === "transform_model") {
    return `[transform_model]\n${asJson({
      ok: result?.ok,
      target_model: result?.targetModel,
      mode: result?.mode,
      error: result?.error,
    })}`;
  }

  if (name === "start_training") {
    return `[start_training]\n${asJson({
      ok: result?.ok,
      error: result?.error,
      config: result?.config,
    })}`;
  }

  if (name === "moving") {
    return `[moving]\n${asJson({
      ok: result?.ok,
      stage: result?.stage,
      error: result?.error,
    })}`;
  }

  if (name === "memory_retrieve") {
    return `[memory_retrieve]\n${asJson(result)}`;
  }

  return `[${name}]\n${asJson(result)}`;
}

export function buildToolAugmentedPrompt({ userText = "", toolResults = [] } = {}) {
  if (!toolResults.length) return userText;

  return `
用户原始问题：
${userText}

下面是工具调用得到的材料。请基于材料回答；如果材料不足，明确说明还需要什么。涉及网页或论文来源时引用 URL 或来源编号；涉及代码时引用文件路径和行号。如果只是 moving、transform_model 或 start_training 这类动作工具，简短自然地确认动作结果即可。

${toolResults.map(formatToolResult).join("\n\n")}
`.trim();
}

export function collectToolReferences(toolResults = []) {
  const refs = [];

  for (const item of toolResults) {
    if (item.name === "web_search") {
      refs.push(
        ...(item.result?.results ?? []).map((result) => ({
          title: result.title,
          source: result.url,
          url: result.url,
        }))
      );
    }

    if (item.name === "read_document" && item.result?.source) {
      const url = item.result.source.url || item.result.source.cache?.url || "";
      refs.push({
        title: item.result.source.name || item.result.source.url || "document",
        source: url || "document",
        url,
      });
    }
  }

  return refs;
}
