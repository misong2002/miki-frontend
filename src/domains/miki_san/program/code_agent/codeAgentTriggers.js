const CODE_SEARCH_PATTERNS = [
  /(搜索|查找|找一下|检索).{0,16}(代码|文件|函数|组件|脚本|接口|模块|class|function)/i,
  /(查一下|看看|看一下).{0,24}(train loop|training loop|训练循环|训练逻辑|代码逻辑|实现逻辑|调用链|pipeline|flow|流程)/i,
  /(train loop|training loop|训练循环|训练逻辑|代码逻辑|实现逻辑|调用链).{0,24}(逻辑|在哪|怎么|如何|查|看)/i,
  /(code|file|function|component|script|module).{0,16}(search|find|grep|look)/i,
];

const CODE_READ_PATTERNS = [
  /(读一下|看一下|打开|阅读|看看).{0,12}(代码|文件|脚本|模块|组件)/i,
  /(read|open|inspect|show).{0,12}(file|script|code|module|component)/i,
];

const CODE_READ_WITH_PATH_PATTERN = /(读一下|看一下|打开|阅读|看看|看|read|open|inspect|show)/i;

const CODE_LIST_PATTERNS = [
  /(列一下|列出|看看目录|目录结构|文件列表|有哪些文件|后台文件夹)/i,
  /(list|tree|directory|folder|files)/i,
];

const TEXT_FILE_EXTENSIONS = [
  "asm",
  "bat",
  "c",
  "cc",
  "cfg",
  "cjs",
  "clj",
  "cljs",
  "cmake",
  "conf",
  "cpp",
  "cs",
  "css",
  "csv",
  "cxx",
  "dart",
  "dockerfile",
  "env",
  "fish",
  "go",
  "graphql",
  "h",
  "hpp",
  "hs",
  "htm",
  "html",
  "ini",
  "ipynb",
  "java",
  "jl",
  "js",
  "json",
  "jsx",
  "kt",
  "kts",
  "less",
  "lua",
  "m",
  "make",
  "markdown",
  "md",
  "mjs",
  "mm",
  "php",
  "pl",
  "proto",
  "py",
  "r",
  "rb",
  "rs",
  "sass",
  "scala",
  "scss",
  "sh",
  "sql",
  "svelte",
  "swift",
  "tex",
  "toml",
  "ts",
  "tsx",
  "txt",
  "vue",
  "xml",
  "yaml",
  "yml",
  "zsh",
];

const PATH_ROOTS = [
  "api",
  "src",
  "scripts",
  "config",
  "shared",
  "public",
  "miki-frontend",
  "training_tools",
  "notebooks",
  "data",
  "log",
  "README.md",
  "Makefile",
];

const PATH_CANDIDATE_PATTERN =
  /[A-Za-z0-9_.@%+=:,()-]+(?:\/[A-Za-z0-9_.@%+=:,()-]+)*|[A-Za-z0-9_.-]+\.[A-Za-z0-9]+/gi;

const TEXT_FILE_EXTENSION_SET = new Set(TEXT_FILE_EXTENSIONS);
const PATH_ROOT_SET = new Set(PATH_ROOTS.map((item) => item.toLowerCase()));

function normalizeText(text = "") {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function getPathExtension(path = "") {
  const name = String(path || "").split("/").pop() || "";
  const dotIndex = name.lastIndexOf(".");
  return dotIndex > 0 ? name.slice(dotIndex + 1).toLowerCase() : "";
}

function looksLikeAllowedPath(path = "") {
  const normalized = String(path || "").replace(/^\/+/, "");
  const firstPart = normalized.split("/")[0]?.toLowerCase() || "";
  if (PATH_ROOT_SET.has(firstPart)) return true;
  const extension = getPathExtension(normalized);
  return extension ? TEXT_FILE_EXTENSION_SET.has(extension) : false;
}

function findPathInText(text = "") {
  const matches = String(text || "").matchAll(PATH_CANDIDATE_PATTERN);
  for (const match of matches) {
    const candidate = match?.[0] || "";
    if (looksLikeAllowedPath(candidate)) return candidate;
  }
  return "";
}

export function detectCodeAgentIntent(text = "") {
  const query = normalizeText(text);
  if (!query) {
    return {
      shouldRun: false,
      mode: "",
      query: "",
      path: "",
    };
  }

  const path = findPathInText(query);

  if (
    CODE_READ_PATTERNS.some((pattern) => pattern.test(query)) ||
    (path && CODE_READ_WITH_PATH_PATTERN.test(query))
  ) {
    return {
      shouldRun: true,
      mode: "read",
      query,
      path,
    };
  }

  if (CODE_SEARCH_PATTERNS.some((pattern) => pattern.test(query))) {
    return {
      shouldRun: true,
      mode: "search",
      query,
      path: "",
    };
  }

  if (CODE_LIST_PATTERNS.some((pattern) => pattern.test(query))) {
    return {
      shouldRun: true,
      mode: "list",
      query,
      path: path || "",
    };
  }

  return {
    shouldRun: false,
    mode: "",
    query,
    path,
  };
}
