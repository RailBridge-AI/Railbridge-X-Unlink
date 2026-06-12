import { writeFile } from "node:fs/promises";

const merchantOsUrl = process.env.MERCHANT_OS_URL || "http://localhost:4030";
const port = Number.parseInt(process.env.PORT || "4025", 10);
const adminEmail = process.env.SDK_SMOKE_EMAIL || "sdk-smoke@example.com";
const adminPassword = process.env.SDK_SMOKE_PASSWORD || "RailBridgeDemo123!";
const merchantName = process.env.SDK_SMOKE_MERCHANT_NAME || "SDK Smoke Merchant";
const apiId = process.env.SDK_SMOKE_API_ID || "premium_api";
const apiName = process.env.SDK_SMOKE_API_NAME || "Premium API";
const routePath = process.env.SDK_SMOKE_ROUTE_PATH || "/api/premium";
const routeMethod = (process.env.SDK_SMOKE_ROUTE_METHOD || "GET").toUpperCase();
const amountUsdc = process.env.SDK_SMOKE_AMOUNT_USDC || "0.01";
const sourceNetwork = process.env.SDK_SMOKE_SOURCE_NETWORK || "eip155:84532";

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const requestJson = async ({ method = "GET", url, headers = {}, body }) => {
  const response = await fetch(url, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text
    ? (() => {
        try {
          return JSON.parse(text);
        } catch {
          return { raw: text };
        }
      })()
    : {};

  if (!response.ok) {
    const message = isObject(payload) ? payload.error || payload.message || response.statusText : response.statusText;
    throw new Error(String(message || `HTTP ${response.status}`));
  }

  return payload;
};

const ensureMerchantLogin = async () => {
  try {
    return await requestJson({
      method: "POST",
      url: `${merchantOsUrl}/v1/auth/login`,
      body: {
        email: adminEmail,
        password: adminPassword,
      },
    });
  } catch (error) {
    if (!/invalid credentials/i.test(String(error?.message || error))) {
      throw error;
    }
  }

  return await requestJson({
    method: "POST",
    url: `${merchantOsUrl}/v1/onboarding/start`,
    body: {
      merchantName,
      adminEmail,
      adminPassword,
      complianceProfile: { country: "US" },
    },
  });
};

const ensureApiKey = async (merchant) => {
  if (merchant.apiKey) {
    return merchant.apiKey;
  }

  const created = await requestJson({
    method: "POST",
    url: `${merchantOsUrl}/v1/onboarding/api-keys`,
    headers: {
      authorization: `Bearer ${merchant.token}`,
    },
    body: {
      name: `Merchant SDK Minimal ${new Date().toISOString()}`,
      role: "admin",
    },
  });

  return String(created.token || "").trim();
};

const ensureProduct = async (merchantId, apiKey) => {
  const list = await requestJson({
    url: `${merchantOsUrl}/v1/merchants/${merchantId}/products`,
    headers: {
      "x-railbridge-api-key": apiKey,
    },
  });

  const items = Array.isArray(list.items) ? list.items : [];
  const existing =
    items.find((item) => item.apiId === apiId) ||
    items.find(
      (item) =>
        String(item.method || "").toUpperCase() === routeMethod &&
        String(item.path || "").trim() === routePath,
    );

  const body = {
    apiId,
    apiName,
    method: routeMethod,
    path: routePath,
    amountUsdc,
    sourceNetwork,
    settlementMode: "same_chain",
    destinationNetwork: null,
    enabled: true,
  };

  if (!existing) {
    return await requestJson({
      method: "POST",
      url: `${merchantOsUrl}/v1/merchants/${merchantId}/products`,
      headers: {
        "x-railbridge-api-key": apiKey,
      },
      body,
    });
  }

  return await requestJson({
    method: "PUT",
    url: `${merchantOsUrl}/v1/merchants/${merchantId}/products/${existing.id}`,
    headers: {
      "x-railbridge-api-key": apiKey,
    },
    body,
  });
};

const merchant = await ensureMerchantLogin();
const apiKey = await ensureApiKey(merchant);
await ensureProduct(merchant.merchantId, apiKey);

const envFile = [
  `PORT=${port}`,
  "RB_ENV=local",
  `RB_API_KEY=${apiKey}`,
].join("\n");

await writeFile(new URL("./.env.local", import.meta.url), `${envFile}\n`, "utf8");

console.log(
  JSON.stringify(
    {
      merchantId: merchant.merchantId,
      accountId: merchant.accountId,
      apiKey,
      route: `${routeMethod} ${routePath}`,
      envFile: ".env.local",
    },
    null,
    2,
  ),
);
