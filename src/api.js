const RAW_API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export function getApiBase() {
  return RAW_API_BASE.replace(/\/+$/, "");
}

export function buildApiUrl(path = "") {
  const normalizedPath = String(path || "");

  if (!normalizedPath) {
    return getApiBase() || "";
  }

  if (/^https?:\/\//.test(normalizedPath)) {
    return normalizedPath;
  }

  const safePath = normalizedPath.startsWith("/")
    ? normalizedPath
    : `/${normalizedPath}`;

  const base = getApiBase();
  return base ? `${base}${safePath}` : safePath;
}
