import { TRAIN_CONFIG_SCHEMA_HINTS } from "./programConfigSchema";

const MAX_CONFIG_CHARS = 14000;

function truncateText(text, maxChars = MAX_CONFIG_CHARS) {
  const value = String(text || "").trim();
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...<truncated>`;
}

export function buildProgramConfigPrompt({ userText = "", configPayload = null } = {}) {
  const config = configPayload?.config ?? configPayload ?? {};
  const configJson = truncateText(JSON.stringify(config, null, 2));
  const schemaJson = truncateText(
    JSON.stringify(TRAIN_CONFIG_SCHEMA_HINTS, null, 2),
    7000
  );

  return `
用户原始问题：
${userText}

下面是当前训练配置 JSON。用户如果要求修改训练参数，你可以通过隐藏控制符修改配置。

当前配置：
\`\`\`json
${configJson}
\`\`\`

参数类型提示：
\`\`\`json
${schemaJson}
\`\`\`

配置控制符格式：
<<config:set PATH=VALUE>>

规则：
- 控制符不会显示给用户。
- PATH 必须来自当前配置的真实路径，例如：
  - sections.optimization_config.lr
  - sections.optimization_config.batch_size
  - sections.optimization_config.rounds
  - sections.model_config.hidden_features
  - sections.model_config.hidden_layers
  - sections.model_config.first_omega_0
  - sections.model_config.hidden_omega_0
  - run_mode
- VALUE 可以是数字、布尔值、null，或普通字符串。
- VALUE 必须符合“参数类型提示”；例如 hidden_layers 用整数，lr 用数字，outermost_linear 用 true/false。
- 如果用户明确要求修改参数，先按系统要求输出情绪/动作控制符，然后立刻输出一个 config 控制符，再用一句话告诉用户你改了什么。
- 如果用户只是询问配置、比较参数或不确定要不要改，不要输出控制符，只解释。
- 不要编造不存在的路径；不确定路径时先说明需要确认。
`.trim();
}
