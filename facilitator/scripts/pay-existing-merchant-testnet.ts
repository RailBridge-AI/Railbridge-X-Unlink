import dotenv from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { PaymentRequirements } from "@x402/core/types";
import { privateKeyToAccount } from "viem/accounts";
import { ExactEvmSchemeDomainClient } from "../src/schemes/exact-evm-domain.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "..", ".env") });

const configFilePath = join(__dirname, "..", "config", "payment-test-config.json");
const configLocalFilePath = join(__dirname, "..", "config", "payment-test-config.local.json");

type SettlementItem = {
  id: string;
  itemType: string;
  settlementId: string | null;
  sourceNetwork: string | null;
  destinationNetwork: string | null;
  amount: string;
  status: string;
  createdAt: string;
};

type MerchantProduct = {
  id: string;
  apiId: string | null;
  method: string;
  path: string;
  enabled: boolean;
};

type MerchantSdkContext = {
  merchantId: string;
  accountId: string;
  merchantName: string;
  accountName: string;
};

const toPlainObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const readJsonObjectFile = (path: string): Record<string, unknown> => {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const parseBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
};

const parseIntValue = (value: unknown, fallback: number): number => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const scriptConfigDefaults = {
  existingMerchantPayment: {
    facilitatorUrl: "http://localhost:4022",
    merchantUrl: "http://localhost:4025",
    merchantOsUrl: "http://localhost:4030",
    apiId: "",
    routeMethod: "GET",
    routePath: "/api/premium",
    sourceNetwork: "eip155:84532",
    preferredPayNetwork: "",
    verifySettlement: true,
    verifyTimeoutMs: 45000,
  },
};

const baseConfig = readJsonObjectFile(configFilePath);
const localConfig = readJsonObjectFile(configLocalFilePath);
const existingMerchantPaymentConfig = {
  ...scriptConfigDefaults.existingMerchantPayment,
  ...toPlainObject(baseConfig.existingMerchantPayment),
  ...toPlainObject(localConfig.existingMerchantPayment),
};

const cfg = {
  facilitatorUrl: String(existingMerchantPaymentConfig.facilitatorUrl || "http://localhost:4022").trim(),
  merchantUrl: String(existingMerchantPaymentConfig.merchantUrl || "http://localhost:4025").trim(),
  merchantOsUrl: String(existingMerchantPaymentConfig.merchantOsUrl || "http://localhost:4030").trim(),
  apiId: String(existingMerchantPaymentConfig.apiId || "").trim(),
  fallbackRoutePath: String(existingMerchantPaymentConfig.routePath || "/api/premium").trim(),
  fallbackRouteMethod: String(existingMerchantPaymentConfig.routeMethod || "GET").trim().toUpperCase(),
  sourceNetwork: String(existingMerchantPaymentConfig.sourceNetwork || "eip155:84532").trim(),
  preferredPayNetwork: String(existingMerchantPaymentConfig.preferredPayNetwork || "").trim(),
  verifySettlement: parseBoolean(existingMerchantPaymentConfig.verifySettlement, true),
  verifyTimeoutMs: parseIntValue(existingMerchantPaymentConfig.verifyTimeoutMs, 45000),
  clientPrivateKey: String(process.env.CLIENT_PRIVATE_KEY || "").trim() as `0x${string}`,
  merchantApiKey: String(process.env.RB_API_KEY || "").trim(),
};

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const assertRequired = (value: string, name: string) => {
  if (!value || !value.trim()) {
    throw new Error(`${name} is required`);
  }
};

const requestJson = async <T>({
  method = "GET",
  url,
  headers,
}: {
  method?: string;
  url: string;
  headers?: Record<string, string>;
}): Promise<T> => {
  const response = await fetch(url, { method, headers });
  const text = await response.text();
  let payload: unknown = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }
  if (!response.ok) {
    const message =
      (isJsonObject(payload) && (payload.error || payload.message)) ||
      `HTTP ${response.status} for ${method} ${url}`;
    throw new Error(String(message));
  }
  return payload as T;
};

const resolveSdkContext = async (apiKey: string): Promise<MerchantSdkContext> => {
  return requestJson<MerchantSdkContext>({
    url: `${cfg.merchantOsUrl}/v1/sdk/context`,
    headers: {
      "x-railbridge-api-key": apiKey,
    },
  });
};

const resolveRouteFromMerchantOs = async ({
  apiKey,
  merchantId,
}: {
  apiKey: string;
  merchantId: string;
}): Promise<{ method: string; path: string; apiId: string | null } | null> => {
  const response = await requestJson<{ items: MerchantProduct[] }>({
    url: `${cfg.merchantOsUrl}/v1/merchants/${merchantId}/products`,
    headers: {
      "x-railbridge-api-key": apiKey,
    },
  });
  const items = Array.isArray(response.items) ? response.items : [];
  if (!items.length) {
    return null;
  }

  const enabledItems = items.filter((item) => item.enabled !== false);
  const scope = enabledItems.length ? enabledItems : items;
  const selected =
    (cfg.apiId
      ? scope.find((item) => String(item.apiId || "").trim() === cfg.apiId)
      : null) || scope[0];
  if (!selected) {
    return null;
  }

  const method = String(selected.method || "").trim().toUpperCase();
  const rawPath = String(selected.path || "").trim();
  const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  if (!method || !path || path === "/") {
    return null;
  }
  return {
    method,
    path,
    apiId: selected.apiId ? String(selected.apiId) : null,
  };
};

const waitForHealth = async (baseUrl: string, timeoutMs = 30_000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // keep polling
    }
    await sleep(400);
  }
  throw new Error(`Timed out waiting for health: ${baseUrl}/health`);
};

const parseSupportedNetworks = async (): Promise<Array<`${string}:${string}`>> => {
  const res = await fetch(`${cfg.facilitatorUrl}/supported`);
  if (!res.ok) {
    return [cfg.sourceNetwork as `${string}:${string}`];
  }
  const body = (await res.json().catch(() => ({}))) as {
    kinds?: Array<{ scheme?: string; network?: string }>;
  };
  const networks = (Array.isArray(body.kinds) ? body.kinds : [])
    .filter((item) => item?.scheme === "exact" && typeof item.network === "string")
    .map((item) => item.network as `${string}:${string}`);
  return networks.length ? Array.from(new Set(networks)) : [cfg.sourceNetwork as `${string}:${string}`];
};

const runPayment = async () => {
  const signer = privateKeyToAccount(cfg.clientPrivateKey);
  const supportedNetworks = await parseSupportedNetworks();
  const preferred = cfg.preferredPayNetwork;

  const selector = (_version: number, options: PaymentRequirements[]) => {
    if (preferred) {
      const match = options.find((option) => option.network === preferred);
      if (match) {
        return match;
      }
    }
    return options[0];
  };

  const client = new x402Client(selector);
  supportedNetworks.forEach((network) => {
    client.register(network, new ExactEvmSchemeDomainClient(signer));
  });

  const wrappedFetch = wrapFetchWithPayment(fetch, client);
  const response = await wrappedFetch(`${cfg.merchantUrl}${resolvedRoute.path}`, {
    method: resolvedRoute.method,
  });
  const settleReceipt = new x402HTTPClient(client).getPaymentSettleResponse((name) =>
    response.headers.get(name),
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Paid request failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const data = await response.json().catch(() => ({}));
  return {
    signerAddress: signer.address,
    responseData: data,
    settleReceipt,
  };
};

const getSettlementIds = async (): Promise<Set<string>> => {
  const timeline = await requestJson<{ items: SettlementItem[] }>({
    url: `${cfg.merchantOsUrl}/v1/merchants/${resolvedContext.merchantId}/settlements`,
    headers: {
      "x-railbridge-api-key": cfg.merchantApiKey,
    },
  });
  const items = Array.isArray(timeline.items) ? timeline.items : [];
  return new Set(items.map((item) => item.id));
};

const waitForSettlement = async (beforeIds: Set<string>): Promise<SettlementItem> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < cfg.verifyTimeoutMs) {
    const timeline = await requestJson<{ items: SettlementItem[] }>({
      url: `${cfg.merchantOsUrl}/v1/merchants/${resolvedContext.merchantId}/settlements`,
      headers: {
        "x-railbridge-api-key": cfg.merchantApiKey,
      },
    });
    const items = Array.isArray(timeline.items) ? timeline.items : [];
    const next = items.find(
      (item) =>
        !beforeIds.has(item.id) &&
        item.itemType === "settlement" &&
        ["settled_source", "bridge_pending", "bridge_confirmed"].includes(item.status),
    );
    if (next) {
      return next;
    }
    await sleep(1000);
  }
  throw new Error("Timed out waiting for new settlement event in Merchant OS timeline");
};

const main = async () => {
  assertRequired(cfg.clientPrivateKey, "CLIENT_PRIVATE_KEY");
  await waitForHealth(cfg.facilitatorUrl, 15_000);
  await waitForHealth(cfg.merchantUrl, 15_000);

  if (cfg.verifySettlement && !cfg.merchantApiKey) {
    console.warn("RB_API_KEY is not set; settlement verification will be skipped.");
  }

  const shouldVerify = cfg.verifySettlement && Boolean(cfg.merchantApiKey);

  if (shouldVerify) {
    resolvedContext = await resolveSdkContext(cfg.merchantApiKey);
    const merchantOsRoute = await resolveRouteFromMerchantOs({
      apiKey: cfg.merchantApiKey,
      merchantId: resolvedContext.merchantId,
    });
    if (merchantOsRoute) {
      resolvedRoute = merchantOsRoute;
    }
  }

  const beforeIds = shouldVerify ? await getSettlementIds() : null;

  const payment = await runPayment();
  console.log("Paid request succeeded");
  console.log(`- merchantUrl: ${cfg.merchantUrl}`);
  console.log(`- route: ${resolvedRoute.method} ${resolvedRoute.path}`);
  if (resolvedRoute.apiId) {
    console.log(`- apiId: ${resolvedRoute.apiId}`);
  }
  console.log(`- signer: ${payment.signerAddress}`);
  console.log(`- response: ${JSON.stringify(payment.responseData)}`);
  if (payment.settleReceipt) {
    console.log(`- tx: ${payment.settleReceipt.transaction}`);
    console.log(`- network: ${payment.settleReceipt.network}`);
    console.log(`- success: ${payment.settleReceipt.success}`);
  }

  if (!shouldVerify) {
    console.log(
      "Skipped Merchant OS settlement verification. Set RB_API_KEY to enable it.",
    );
    return;
  }

  const settlement = await waitForSettlement(beforeIds || new Set<string>());
  console.log("Settlement observed in Merchant OS");
  console.log(`- settlementId: ${settlement.settlementId || settlement.id}`);
  console.log(`- status: ${settlement.status}`);
  console.log(`- sourceNetwork: ${settlement.sourceNetwork || "-"}`);
  console.log(`- destinationNetwork: ${settlement.destinationNetwork || "-"}`);
  console.log(`- amount(base units): ${settlement.amount}`);
};

let resolvedContext: MerchantSdkContext = {
  merchantId: "",
  accountId: "",
  merchantName: "",
  accountName: "",
};

let resolvedRoute: { method: string; path: string; apiId: string | null } = {
  method: cfg.fallbackRouteMethod,
  path: cfg.fallbackRoutePath,
  apiId: cfg.apiId || null,
};

main().catch((error) => {
  console.error("Existing merchant payment test failed");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
