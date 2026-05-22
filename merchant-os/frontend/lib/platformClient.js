export const AUTH_STORAGE_KEY = "railbridge-platform-auth";

export const readAuth = () => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.merchantId || !parsed?.accountId) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const saveAuth = (payload) => {
  if (typeof window === "undefined") {
    return;
  }
  const { apiKey: _apiKey, ...safePayload } = payload || {};
  window.sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(safePayload));
};

export const clearAuth = () => {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.removeItem(AUTH_STORAGE_KEY);
};

const parseJson = async (response) => response.json().catch(() => ({}));

export const apiWithSession = async ({ token, path, method = "GET", body }) => {
  const response = await fetch(path, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const payload = await parseJson(response);
  if (!response.ok) {
    throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
  }
  return payload;
};

export const apiWithMerchantKey = async ({ apiKey, token, path, method = "GET", body }) => {
  const resolvedToken = token || readAuth()?.token || "";
  const headers = {
    "content-type": "application/json"
  };
  if (apiKey) {
    headers["x-railbridge-api-key"] = apiKey;
  } else if (resolvedToken) {
    headers.authorization = `Bearer ${resolvedToken}`;
  }
  const response = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const payload = await parseJson(response);
  if (!response.ok) {
    throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
  }
  return payload;
};
