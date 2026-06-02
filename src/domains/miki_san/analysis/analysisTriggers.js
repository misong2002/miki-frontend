const SEARCH_TRIGGER_PATTERNS = [
  /(^|\s)(search|google|web\s*search|look\s*up|latest|recent|news)(\s|$)/i,
  /(搜索|搜一下|查一下|查找|联网|上网查|网上查|网页搜索|最新|最近|新闻|资料)/,
];
const LOCAL_CODE_CONTEXT_PATTERN =
  /(train loop|training loop|训练循环|训练逻辑|代码逻辑|实现逻辑|调用链|pipeline|flow|流程|函数|组件|脚本|接口|模块|src\/|api\/|scripts\/)/i;

const ARXIV_ID_PATTERN =
  /(?:arxiv\s*[:：]?\s*|arxiv\.org\/(?:abs|pdf)\/)?(\d{4}\.\d{4,5})(?:v\d+)?/i;
const DOCUMENT_URL_PATTERN =
  /(https?:\/\/[^\s)）]+?\.(?:pdf|docx|txt|md|markdown|tex|csv|json|html|htm)(?:\?[^\s)）]*)?)/i;

function normalizeQueryText(text = "") {
  return String(text || "").replace(/\s+/g, " ").trim();
}

export function detectWebSearchIntent(text = "") {
  const query = normalizeQueryText(text);
  if (!query) {
    return {
      shouldSearch: false,
      query: "",
    };
  }

  if (LOCAL_CODE_CONTEXT_PATTERN.test(query) && !/(联网|上网查|网上查|网页搜索|google|web\s*search|latest|recent|news|最新|新闻)/i.test(query)) {
    return {
      shouldSearch: false,
      query,
    };
  }

  const shouldSearch = SEARCH_TRIGGER_PATTERNS.some((pattern) =>
    pattern.test(query)
  );

  return {
    shouldSearch,
    query,
  };
}

export function detectArxivId(text = "") {
  const match = String(text || "").match(ARXIV_ID_PATTERN);
  return match?.[1] ?? "";
}

export function detectDocumentUrl(text = "") {
  const match = String(text || "").match(DOCUMENT_URL_PATTERN);
  return match?.[1] ?? "";
}
