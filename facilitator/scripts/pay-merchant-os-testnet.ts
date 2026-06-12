import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { PaymentRequirements } from "@x402/core/types";
import { privateKeyToAccount } from "viem/accounts";
import { ExactEvmSchemeDomainClient } from "../src/schemes/exact-evm-domain.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "..", ".env") });

type MerchantLogin = {
  token: string;
  apiKey?: string;
  merchantId: string;
  accountId: string;
};

type CreatedApiKey = {
  token: string;
};

type MerchantProduct = {
  id: string;
  apiId: string;
  apiName: string;
  method: string;
  path: string;
  sourceNetwork: string;
  settlementMode: "same_chain" | "cross_chain";
  destinationNetwork: string | null;
  enabled: boolean;
};

type SettlementItem = {
  id: string;
  itemType: string;
  settlementId: string | null;
  apiId: string | null;
  apiRoute: string | null;
  sourceNetwork: string | null;
  destinationNetwork: string | null;
  amount: string;
  status: string;
  createdAt: string;
};

const cfg = {
  facilitatorUrl: String(process.env.FACILITATOR_URL || "http://localhost:4022").trim(),
  merchantOsUrl: String(process.env.MERCHANT_OS_API_URL || "http://localhost:4030").trim(),
  merchantAppPort: Number.parseInt(process.env.RB_MERCHANT_PORT || "4025", 10),
  routePath: "/api/premium",
  routeMethod: "GET",
  adminEmail: String(process.env.RB_ADMIN_EMAIL || "ops@example.com").trim().toLowerCase(),
  adminPassword: String(process.env.RB_ADMIN_PASSWORD || "RailBridgeDemo123!").trim(),
  merchantName: String(process.env.RB_MERCHANT_NAME || "Spotlight Merchant").trim(),
  apiId: String(process.env.RB_API_ID || "premium_api").trim(),
  apiName: String(process.env.RB_API_NAME || "Premium API").trim(),
  amountUsdc: String(process.env.RB_AMOUNT_USDC || "0.01").trim(),
  sourceNetwork: String(process.env.RB_SOURCE_NETWORK || "eip155:84532").trim(),
  settlementMode: String(process.env.RB_PRODUCT_SETTLEMENT_MODE || "same_chain")
    .trim()
    .toLowerCase() as "same_chain" | "cross_chain",
  destinationNetwork: String(process.env.RB_DEST_NETWORK || "").trim(),
  clientPrivateKey: String(process.env.CLIENT_PRIVATE_KEY || "").trim() as `0x${string}`,
  preferredPayNetwork: String(process.env.RB_PAY_NETWORK || "").trim(),
};

const merchantAppUrl = `http://localhost:${cfg.merchantAppPort}`;
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
  body,
}: {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}): Promise<{ status: number; data: T }> => {
  const response = await fetch(url, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(headers || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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
  return { status: response.status, data: payload as T };
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

const ensureMerchantLogin = async (): Promise<MerchantLogin> => {
  try {
    const login = await requestJson<MerchantLogin>({
      method: "POST",
      url: `${cfg.merchantOsUrl}/v1/auth/login`,
      body: {
        email: cfg.adminEmail,
        password: cfg.adminPassword,
      },
    });
    return login.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/invalid credentials/i.test(message)) {
      throw error;
    }
  }

  const onboard = await requestJson<MerchantLogin>({
    method: "POST",
    url: `${cfg.merchantOsUrl}/v1/onboarding/start`,
    body: {
      merchantName: cfg.merchantName,
      adminEmail: cfg.adminEmail,
      adminPassword: cfg.adminPassword,
      complianceProfile: { country: "US" },
    },
  });
  return onboard.data;
};

const ensureMerchantApiKey = async (merchant: MerchantLogin): Promise<string> => {
  const existingApiKey = String(merchant.apiKey || "").trim();
  if (existingApiKey) {
    return existingApiKey;
  }

  const created = await requestJson<CreatedApiKey>({
    method: "POST",
    url: `${cfg.merchantOsUrl}/v1/onboarding/api-keys`,
    headers: {
      authorization: `Bearer ${merchant.token}`,
    },
    body: {
      name: `Smoke Test API Key ${new Date().toISOString()}`,
      role: "admin",
    },
  });

  const apiKey = String(created.data.token || "").trim();
  assertRequired(apiKey, "created api key token");
  return apiKey;
};

const findExistingProduct = (items: MerchantProduct[]) =>
  items.find((item) => item.apiId === cfg.apiId) ||
  items.find(
    (item) =>
      String(item.method || "").toUpperCase() === cfg.routeMethod &&
      String(item.path || "").trim() === cfg.routePath,
  );

const ensurePaidProduct = async (merchant: MerchantLogin): Promise<MerchantProduct> => {
  const list = await requestJson<{ items: MerchantProduct[] }>({
    url: `${cfg.merchantOsUrl}/v1/merchants/${merchant.merchantId}/products`,
    headers: {
      "x-railbridge-api-key": merchant.apiKey,
    },
  });

  const existing = findExistingProduct(Array.isArray(list.data.items) ? list.data.items : []);
  const destinationNetwork =
    cfg.settlementMode === "cross_chain" && cfg.destinationNetwork
      ? cfg.destinationNetwork
      : null;

  if (!existing) {
    const created = await requestJson<MerchantProduct>({
      method: "POST",
      url: `${cfg.merchantOsUrl}/v1/merchants/${merchant.merchantId}/products`,
      headers: {
        "x-railbridge-api-key": merchant.apiKey,
      },
      body: {
        apiId: cfg.apiId,
        apiName: cfg.apiName,
        method: cfg.routeMethod,
        path: cfg.routePath,
        amountUsdc: cfg.amountUsdc,
        sourceNetwork: cfg.sourceNetwork,
        settlementMode: cfg.settlementMode,
        destinationNetwork,
      },
    });
    return created.data;
  }

  const updated = await requestJson<MerchantProduct>({
    method: "PUT",
    url: `${cfg.merchantOsUrl}/v1/merchants/${merchant.merchantId}/products/${existing.id}`,
    headers: {
      "x-railbridge-api-key": merchant.apiKey,
    },
    body: {
      apiName: cfg.apiName,
      method: cfg.routeMethod,
      path: cfg.routePath,
      amountUsdc: cfg.amountUsdc,
      sourceNetwork: cfg.sourceNetwork,
      settlementMode: cfg.settlementMode,
      destinationNetwork,
      enabled: true,
    },
  });
  return updated.data;
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

const startMerchantServer = async (merchantApiKey: string): Promise<ChildProcess> => {
  const cmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(cmd, ["run", "test:merchant-os-demo"], {
    cwd: join(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(cfg.merchantAppPort),
      RB_ENV: "sandbox",
      RB_API_KEY: merchantApiKey,
      RB_API_ID: cfg.apiId,
      RB_SETTLEMENT_MODE_OVERRIDE: cfg.settlementMode,
      MERCHANT_URL: merchantAppUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const prefix = "[merchant-app]";
  child.stdout.on("data", (chunk) => process.stdout.write(`${prefix} ${String(chunk)}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`${prefix} ${String(chunk)}`));

  await waitForHealth(merchantAppUrl, 25_000);
  return child;
};

const runPayment = async ({
  signerKey,
  targetUrl,
}: {
  signerKey: `0x${string}`;
  targetUrl: string;
}) => {
  const signer = privateKeyToAccount(signerKey);
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
  const startedAt = Date.now();
  const response = await wrappedFetch(targetUrl, {
    method: cfg.routeMethod,
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
    startedAt,
    responseData: data,
    settleReceipt,
  };
};

const waitForSettlement = async ({
  merchantId,
  apiKey,
  beforeIds,
  timeoutMs = 45_000,
}: {
  merchantId: string;
  apiKey: string;
  beforeIds: Set<string>;
  timeoutMs?: number;
}) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const timeline = await requestJson<{ items: SettlementItem[] }>({
      url: `${cfg.merchantOsUrl}/v1/merchants/${merchantId}/settlements`,
      headers: {
        "x-railbridge-api-key": apiKey,
      },
    });
    const items = Array.isArray(timeline.data.items) ? timeline.data.items : [];
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

const getSettlementIds = async (merchantId: string, apiKey: string) => {
  const timeline = await requestJson<{ items: SettlementItem[] }>({
    url: `${cfg.merchantOsUrl}/v1/merchants/${merchantId}/settlements`,
    headers: {
      "x-railbridge-api-key": apiKey,
    },
  });
  const items = Array.isArray(timeline.data.items) ? timeline.data.items : [];
  return new Set(items.map((item) => item.id));
};

const main = async () => {
  assertRequired(cfg.clientPrivateKey, "CLIENT_PRIVATE_KEY");
  assertRequired(cfg.adminEmail, "RB_ADMIN_EMAIL");
  assertRequired(cfg.adminPassword, "RB_ADMIN_PASSWORD");
  assertRequired(cfg.apiId, "RB_API_ID");

  await waitForHealth(cfg.merchantOsUrl, 15_000);
  await waitForHealth(cfg.facilitatorUrl, 15_000);

  const merchant = await ensureMerchantLogin();
  const merchantApiKey = await ensureMerchantApiKey(merchant);
  const product = await ensurePaidProduct({
    ...merchant,
    apiKey: merchantApiKey,
  });
  const beforeIds = await getSettlementIds(merchant.merchantId, merchantApiKey);

  console.log("Merchant context");
  console.log(`- merchantId: ${merchant.merchantId}`);
  console.log(`- accountId: ${merchant.accountId}`);
  console.log("Product configuration");
  console.log(`- apiId: ${product.apiId}`);
  console.log(`- route: ${product.method} ${product.path}`);
  console.log(`- sourceNetwork: ${product.sourceNetwork}`);
  console.log(`- settlementMode: ${product.settlementMode}`);
  console.log(`- destinationNetwork: ${product.destinationNetwork || "same_chain"}`);

  let merchantServer: ChildProcess | null = null;
  try {
    merchantServer = await startMerchantServer(merchantApiKey);
    const payment = await runPayment({
      signerKey: cfg.clientPrivateKey,
      targetUrl: `${merchantAppUrl}${cfg.routePath}`,
    });
    console.log("Paid request succeeded");
    console.log(`- signer: ${payment.signerAddress}`);
    console.log(`- response: ${JSON.stringify(payment.responseData)}`);
    if (payment.settleReceipt) {
      console.log(`- tx: ${payment.settleReceipt.transaction}`);
      console.log(`- network: ${payment.settleReceipt.network}`);
      console.log(`- success: ${payment.settleReceipt.success}`);
    }

    const settlement = await waitForSettlement({
      merchantId: merchant.merchantId,
      apiKey: merchantApiKey,
      beforeIds,
    });
    console.log("Settlement observed in Merchant OS");
    console.log(`- settlementId: ${settlement.settlementId || settlement.id}`);
    console.log(`- status: ${settlement.status}`);
    console.log(`- sourceNetwork: ${settlement.sourceNetwork || "-"}`);
    console.log(`- destinationNetwork: ${settlement.destinationNetwork || "-"}`);
    console.log(`- amount(base units): ${settlement.amount}`);

    console.log("\nDone. You can now verify in dashboard:");
    console.log(`- Merchant OS UI: ${cfg.merchantOsUrl.replace(":4030", ":3000")}/onboarding`);
    console.log(
      `- Overview page for balance state: ${cfg.merchantOsUrl.replace(":4030", ":3000")}/overview`,
    );
    console.log(
      `- Settlements API: ${cfg.merchantOsUrl}/v1/merchants/${merchant.merchantId}/settlements`,
    );
  } finally {
    if (merchantServer && merchantServer.exitCode === null) {
      merchantServer.kill("SIGTERM");
      await sleep(400);
    }
  }
};

main().catch((error) => {
  console.error("Real payment test failed");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
