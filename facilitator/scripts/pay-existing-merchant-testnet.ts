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

type MerchantSdkContext = {
  merchantId: string;
  accountId: string;
  merchantName: string;
  accountName: string;
};

type RouteTarget = {
  method: string;
  path: string;
  apiId: string | null;
};

type ExistingMerchantScriptConfig = {
  facilitatorUrl: string;
  merchantUrl: string;
  merchantOsUrl: string;
  apiId: string;
  fallbackRoutePath: string;
  fallbackRouteMethod: string;
  sourceNetwork: string;
  preferredPayNetworks: string[];
  verifySettlement: boolean;
  verifyTimeoutMs: number;
  healthTimeoutMs: number;
  clientPrivateKey: `0x${string}`;
  verificationApiKey: string;
};

type ObserverContext = {
  merchantId: string;
};

type ClientPaymentAttempt = {
  network: `${string}:${string}`;
  label: string;
};

type ClientPaymentResult = {
  signerAddress: string;
  responseData: unknown;
  settleReceipt: ReturnType<x402HTTPClient["getPaymentSettleResponse"]>;
  selectedNetwork: `${string}:${string}`;
};

const TEST_CLIENT_NETWORKS = {
  baseSepolia: "eip155:84532",
  arbitrumSepolia: "eip155:421614",
} as const;

const DEFAULT_CLIENT_PAY_NETWORKS = [
  TEST_CLIENT_NETWORKS.baseSepolia,
  TEST_CLIENT_NETWORKS.arbitrumSepolia,
] as const;

const NETWORK_LABELS: Record<string, string> = {
  [TEST_CLIENT_NETWORKS.baseSepolia]: "Base Sepolia",
  [TEST_CLIENT_NETWORKS.arbitrumSepolia]: "Arbitrum Sepolia",
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

const parseStringArray = (value: unknown, fallback: readonly string[]): string[] => {
  const normalized = Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : typeof value === "string"
      ? value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : [...fallback];
  return Array.from(new Set(normalized));
};

const labelForNetwork = (network: string) => NETWORK_LABELS[network] || network;

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

const formatFetchError = (error: unknown): string => {
  if (error instanceof Error) {
    const cause =
      error.cause && typeof error.cause === "object"
        ? String((error.cause as { message?: unknown }).message || error.cause)
        : "";
    return cause ? `${error.message} (cause: ${cause})` : error.message;
  }
  return String(error);
};

const waitForHealth = async (baseUrl: string, timeoutMs = 30_000) => {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = formatFetchError(error);
    }
    await sleep(400);
  }
  const details = lastError ? ` (last error: ${lastError})` : "";
  throw new Error(`Timed out waiting for health: ${baseUrl}/health${details}`);
};

const loadScriptConfig = (): ExistingMerchantScriptConfig => {
  const configSection = String(
    process.env.PAYMENT_TEST_CONFIG_SECTION || "existingMerchantPayment"
  )
    .trim();
  const scriptConfigDefaults = {
    existingMerchantPayment: {
      facilitatorUrl: "http://localhost:4022",
      merchantUrl: "http://localhost:4025",
      merchantOsUrl: "http://localhost:4030",
      apiId: "",
      routeMethod: "GET",
      routePath: "/api/premium",
      sourceNetwork: TEST_CLIENT_NETWORKS.baseSepolia,
      preferredPayNetworks: [...DEFAULT_CLIENT_PAY_NETWORKS],
      verifySettlement: true,
      verifyTimeoutMs: 45000,
      healthTimeoutMs: 15000,
    },
    existingMerchantPaymentPublicTestnet: {
      facilitatorUrl: "https://facilitator.testnet.railbridge.ai",
      merchantUrl: "https://demo.testnet.railbridge.ai",
      merchantOsUrl: "https://api.testnet.railbridge.ai",
      apiId: "premium_api",
      routeMethod: "GET",
      routePath: "/api/premium",
      sourceNetwork: TEST_CLIENT_NETWORKS.baseSepolia,
      preferredPayNetworks: [...DEFAULT_CLIENT_PAY_NETWORKS],
      verifySettlement: true,
      verifyTimeoutMs: 45000,
      healthTimeoutMs: 60000,
    },
  };

  const baseConfig = readJsonObjectFile(configFilePath);
  const localConfig = readJsonObjectFile(configLocalFilePath);
  const defaultsBySection = toPlainObject(scriptConfigDefaults);
  const defaultSectionConfig =
    defaultsBySection[configSection] || scriptConfigDefaults.existingMerchantPayment;
  const existingMerchantPaymentConfig = {
    ...toPlainObject(defaultSectionConfig),
    ...toPlainObject(baseConfig[configSection]),
    ...toPlainObject(localConfig[configSection]),
  };
  const configuredPayNetworksRaw = (existingMerchantPaymentConfig as Record<string, unknown>).preferredPayNetworks
    ?? (existingMerchantPaymentConfig as Record<string, unknown>).preferredPayNetwork;

  const preferredPayNetworks = parseStringArray(
    configuredPayNetworksRaw,
    DEFAULT_CLIENT_PAY_NETWORKS,
  );

  return {
    facilitatorUrl: String(existingMerchantPaymentConfig.facilitatorUrl || "http://localhost:4022").trim(),
    merchantUrl: String(existingMerchantPaymentConfig.merchantUrl || "http://localhost:4025").trim(),
    merchantOsUrl: String(existingMerchantPaymentConfig.merchantOsUrl || "http://localhost:4030").trim(),
    apiId: String(existingMerchantPaymentConfig.apiId || "").trim(),
    fallbackRoutePath: String(existingMerchantPaymentConfig.routePath || "/api/premium").trim(),
    fallbackRouteMethod: String(existingMerchantPaymentConfig.routeMethod || "GET").trim().toUpperCase(),
    sourceNetwork: String(existingMerchantPaymentConfig.sourceNetwork || TEST_CLIENT_NETWORKS.baseSepolia).trim(),
    preferredPayNetworks,
    verifySettlement: parseBoolean(existingMerchantPaymentConfig.verifySettlement, true),
    verifyTimeoutMs: parseIntValue(existingMerchantPaymentConfig.verifyTimeoutMs, 45000),
    healthTimeoutMs: parseIntValue(existingMerchantPaymentConfig.healthTimeoutMs, 30000),
    clientPrivateKey: String(process.env.CLIENT_PRIVATE_KEY || "").trim() as `0x${string}`,
    // Optional post-payment verification only. Never used for the payer/client request.
    verificationApiKey: String(
      process.env.RB_VERIFICATION_API_KEY || process.env.RB_API_KEY || "",
    ).trim(),
  };
};

// ---------------------------------------------------------------------------
// Optional Merchant OS observer helpers
// These helpers are test-harness only. They use Merchant OS APIs to:
// 1. resolve the current paid route for convenience
// 2. verify that settlement appeared in RailBridge after the client pays
// A real payer/client does NOT need any of this.
// ---------------------------------------------------------------------------

const resolveSdkContextForObserver = async ({
  merchantOsUrl,
  apiKey,
}: {
  merchantOsUrl: string;
  apiKey: string;
}): Promise<MerchantSdkContext> => {
  return requestJson<MerchantSdkContext>({
    url: `${merchantOsUrl}/v1/sdk/context`,
    headers: {
      "x-railbridge-api-key": apiKey,
    },
  });
};

const getSettlementIdsForObserver = async ({
  merchantOsUrl,
  apiKey,
  merchantId,
}: {
  merchantOsUrl: string;
  apiKey: string;
  merchantId: string;
}): Promise<Set<string>> => {
  const timeline = await requestJson<{ items: SettlementItem[] }>({
    url: `${merchantOsUrl}/v1/merchants/${merchantId}/settlements`,
    headers: {
      "x-railbridge-api-key": apiKey,
    },
  });
  const items = Array.isArray(timeline.items) ? timeline.items : [];
  return new Set(items.map((item) => item.id));
};

const waitForSettlementForObserver = async ({
  merchantOsUrl,
  apiKey,
  merchantId,
  beforeIds,
  timeoutMs,
}: {
  merchantOsUrl: string;
  apiKey: string;
  merchantId: string;
  beforeIds: Set<string>;
  timeoutMs: number;
}): Promise<SettlementItem> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const timeline = await requestJson<{ items: SettlementItem[] }>({
      url: `${merchantOsUrl}/v1/merchants/${merchantId}/settlements`,
      headers: {
        "x-railbridge-api-key": apiKey,
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

const prepareObserverContextForVerification = async ({
  merchantOsUrl,
  apiKey,
}: {
  merchantOsUrl: string;
  apiKey: string;
}): Promise<ObserverContext> => {
  const context = await resolveSdkContextForObserver({
    merchantOsUrl,
    apiKey,
  });
  return {
    merchantId: context.merchantId,
  };
};

// ---------------------------------------------------------------------------
// Pure client payment flow
// This is the only part that models the actual payer/client integration.
// It does NOT call Merchant OS or use merchant API credentials.
// ---------------------------------------------------------------------------

const resolveClientPaymentAttempts = (preferredPayNetworks: string[]): ClientPaymentAttempt[] => {
  return parseStringArray(preferredPayNetworks, DEFAULT_CLIENT_PAY_NETWORKS).map((network) => ({
    network: network as `${string}:${string}`,
    label: labelForNetwork(network),
  }));
};

const parseSupportedClientNetworks = async ({
  facilitatorUrl,
  fallbackSourceNetwork,
}: {
  facilitatorUrl: string;
  fallbackSourceNetwork: string;
}): Promise<Array<`${string}:${string}`>> => {
  const res = await fetch(`${facilitatorUrl}/supported`);
  if (!res.ok) {
    return [fallbackSourceNetwork as `${string}:${string}`];
  }
  const body = (await res.json().catch(() => ({}))) as {
    kinds?: Array<{ scheme?: string; network?: string }>;
  };
  const networks = (Array.isArray(body.kinds) ? body.kinds : [])
    .filter((item) => item?.scheme === "exact" && typeof item.network === "string")
    .map((item) => item.network as `${string}:${string}`);
  return networks.length
    ? Array.from(new Set(networks))
    : [fallbackSourceNetwork as `${string}:${string}`];
};

const runPureClientPayment = async ({
  facilitatorUrl,
  merchantUrl,
  route,
  fallbackSourceNetwork,
  preferredPayNetwork,
  clientPrivateKey,
}: {
  facilitatorUrl: string;
  merchantUrl: string;
  route: RouteTarget;
  fallbackSourceNetwork: string;
  preferredPayNetwork: `${string}:${string}`;
  clientPrivateKey: `0x${string}`;
}): Promise<ClientPaymentResult> => {
  const signer = privateKeyToAccount(clientPrivateKey);
  const supportedNetworks = await parseSupportedClientNetworks({
    facilitatorUrl,
    fallbackSourceNetwork,
  });

  const selector = (_version: number, options: PaymentRequirements[]) => {
    const preferredMatch = options.find((option) => option.network === preferredPayNetwork);
    if (!preferredMatch) {
      const available = options.map((option) => option.network).join(", ") || "none";
      throw new Error(
        `Preferred pay network ${preferredPayNetwork} was not offered by the merchant route. Available options: ${available}`,
      );
    }
    return preferredMatch;
  };

  const client = new x402Client(selector);
  supportedNetworks.forEach((network) => {
    client.register(network, new ExactEvmSchemeDomainClient(signer));
  });

  const wrappedFetch = wrapFetchWithPayment(fetch, client);
  const response = await wrappedFetch(`${merchantUrl}${route.path}`, {
    method: route.method,
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
    selectedNetwork: preferredPayNetwork,
  };
};

const logPaymentResult = ({
  attempt,
  payment,
  route,
  merchantUrl,
}: {
  attempt: ClientPaymentAttempt;
  payment: ClientPaymentResult;
  route: RouteTarget;
  merchantUrl: string;
}) => {
  console.log(`Paid request succeeded (${attempt.label})`);
  console.log(`- merchantUrl: ${merchantUrl}`);
  console.log(`- route: ${route.method} ${route.path}`);
  if (route.apiId) {
    console.log(`- apiId: ${route.apiId}`);
  }
  console.log(`- requested client pay network: ${attempt.network}`);
  console.log(`- signer: ${payment.signerAddress}`);
  console.log(`- response: ${JSON.stringify(payment.responseData)}`);
  if (payment.settleReceipt) {
    console.log(`- tx: ${payment.settleReceipt.transaction}`);
    console.log(`- settled network: ${payment.settleReceipt.network}`);
    console.log(`- success: ${payment.settleReceipt.success}`);
  }
};

const main = async () => {
  const config = loadScriptConfig();
  const paymentRoute: RouteTarget = {
    method: config.fallbackRouteMethod,
    path: config.fallbackRoutePath,
    apiId: config.apiId || null,
  };
  const attempts = resolveClientPaymentAttempts(config.preferredPayNetworks);
  const wantsVerification = config.verifySettlement;
  const canVerify = wantsVerification && Boolean(config.verificationApiKey);

  assertRequired(config.clientPrivateKey, "CLIENT_PRIVATE_KEY");
  await waitForHealth(config.facilitatorUrl, config.healthTimeoutMs);
  await waitForHealth(config.merchantUrl, config.healthTimeoutMs);

  if (wantsVerification && !config.verificationApiKey) {
    console.warn(
      "RB_VERIFICATION_API_KEY (or RB_API_KEY) is not set; Merchant OS verification will be skipped.",
    );
  }

  console.log(`Client payment route: ${paymentRoute.method} ${paymentRoute.path}`);
  console.log(`Client payment attempts: ${attempts.map((attempt) => attempt.label).join(", ")}`);

  for (const attempt of attempts) {
    console.log(`\n=== Paying from ${attempt.label} ===`);

    let beforeIds: Set<string> | null = null;
    let observerContext: ObserverContext | null = null;
    if (canVerify) {
      try {
        observerContext = await prepareObserverContextForVerification({
          merchantOsUrl: config.merchantOsUrl,
          apiKey: config.verificationApiKey,
        });
        beforeIds = await getSettlementIdsForObserver({
          merchantOsUrl: config.merchantOsUrl,
          apiKey: config.verificationApiKey,
          merchantId: observerContext.merchantId,
        });
      } catch (error) {
        console.warn(
          `Merchant OS verification unavailable (${formatFetchError(error)}); continuing with client payment only.`,
        );
      }
    }

    const payment = await runPureClientPayment({
      facilitatorUrl: config.facilitatorUrl,
      merchantUrl: config.merchantUrl,
      route: paymentRoute,
      fallbackSourceNetwork: config.sourceNetwork,
      preferredPayNetwork: attempt.network,
      clientPrivateKey: config.clientPrivateKey,
    });

    logPaymentResult({
      attempt,
      payment,
      route: paymentRoute,
      merchantUrl: config.merchantUrl,
    });

    if (!canVerify || !observerContext || !beforeIds) {
      if (wantsVerification) {
        console.log(
          "Skipped Merchant OS verification. Set RB_VERIFICATION_API_KEY to enable post-payment observation.",
        );
      }
      continue;
    }

    try {
      const settlement = await waitForSettlementForObserver({
        merchantOsUrl: config.merchantOsUrl,
        apiKey: config.verificationApiKey,
        merchantId: observerContext.merchantId,
        beforeIds,
        timeoutMs: config.verifyTimeoutMs,
      });

      console.log(`Settlement observed in Merchant OS (${attempt.label})`);
      console.log(`- settlementId: ${settlement.settlementId || settlement.id}`);
      console.log(`- status: ${settlement.status}`);
      console.log(`- sourceNetwork: ${settlement.sourceNetwork || "-"}`);
      console.log(`- destinationNetwork: ${settlement.destinationNetwork || "-"}`);
      console.log(`- amount(base units): ${settlement.amount}`);
    } catch (error) {
      console.warn(
        `Merchant OS settlement verification failed (${formatFetchError(error)}); client payment already succeeded.`,
      );
    }
  }
};

main().catch((error) => {
  console.error("Existing merchant payment test failed");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
