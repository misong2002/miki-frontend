const RAW_API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export function getApiBase() {
  const base = RAW_API_BASE.replace(/\/+$/, "");

  if (!base || typeof window === "undefined") {
    return base;
  }

  try {
    const apiUrl = new URL(base);
    const pageHost = window.location.hostname;

    if (
      pageHost &&
      pageHost !== "localhost" &&
      pageHost !== "127.0.0.1" &&
      (apiUrl.hostname === "localhost" || apiUrl.hostname === "127.0.0.1")
    ) {
      apiUrl.hostname = pageHost;
      return apiUrl.toString().replace(/\/+$/, "");
    }
  } catch {
    return base;
  }

  return base;
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
