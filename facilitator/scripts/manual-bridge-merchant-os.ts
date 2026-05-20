import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "..", ".env") });

type MerchantLogin = {
  token: string;
  apiKey: string;
  merchantId: string;
  accountId: string;
};

type ConsolidationResponse = {
  id: string;
  merchantId: string;
  accountId: string;
  sourceNetwork: string;
  destinationNetwork: string;
  asset: string;
  amount: string;
  status: string;
  txHash?: string | null;
  sourceTxHash?: string | null;
  bridgeTxHash?: string | null;
  destinationTxHash?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

const cfg = {
  merchantOsUrl: String(process.env.MERCHANT_OS_API_URL || "http://localhost:4030").trim(),
  adminEmail: String(process.env.RB_ADMIN_EMAIL || "ops@example.com").trim().toLowerCase(),
  adminPassword: String(process.env.RB_ADMIN_PASSWORD || "RailBridgeDemo123!").trim(),
  sourceNetwork: String(process.env.RB_BRIDGE_SOURCE_NETWORK || "eip155:84532").trim(),
  destinationNetwork: String(process.env.RB_BRIDGE_DEST_NETWORK || "eip155:421614").trim(),
  amountUsdc: String(process.env.RB_BRIDGE_AMOUNT_USDC || "0.005").trim(),
  requireRealBridge:
    String(process.env.RB_REQUIRE_REAL_BRIDGE || "true").trim().toLowerCase() === "true",
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
  body,
}: {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}): Promise<T> => {
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
  return payload as T;
};

const ensureMerchantLogin = async (): Promise<MerchantLogin> =>
  await requestJson<MerchantLogin>({
    method: "POST",
    url: `${cfg.merchantOsUrl}/v1/auth/login`,
    body: {
      email: cfg.adminEmail,
      password: cfg.adminPassword,
    },
  });

const run = async () => {
  assertRequired(cfg.adminEmail, "RB_ADMIN_EMAIL");
  assertRequired(cfg.adminPassword, "RB_ADMIN_PASSWORD");
  assertRequired(cfg.sourceNetwork, "RB_BRIDGE_SOURCE_NETWORK");
  assertRequired(cfg.destinationNetwork, "RB_BRIDGE_DEST_NETWORK");
  assertRequired(cfg.amountUsdc, "RB_BRIDGE_AMOUNT_USDC");

  const merchant = await ensureMerchantLogin();
  const consolidation = await requestJson<ConsolidationResponse>({
    method: "POST",
    url: `${cfg.merchantOsUrl}/v1/merchants/${merchant.merchantId}/consolidations`,
    headers: {
      "x-railbridge-api-key": merchant.apiKey,
    },
    body: {
      sourceNetwork: cfg.sourceNetwork,
      destinationNetwork: cfg.destinationNetwork,
      amountUsdc: cfg.amountUsdc,
    },
  });

  if (cfg.requireRealBridge) {
    const hasTxHash = Boolean(
      consolidation.txHash ||
        consolidation.sourceTxHash ||
        consolidation.bridgeTxHash ||
        consolidation.destinationTxHash,
    );
    if (String(consolidation.status || "").toLowerCase() === "confirmed" && !hasTxHash) {
      throw new Error(
        "Consolidation confirmed without tx hash. Merchant OS appears to be in simulation mode for bridge execution.",
      );
    }
  }

  console.log("Manual bridge submitted");
  console.log(`- merchantId: ${merchant.merchantId}`);
  console.log(`- sourceNetwork: ${consolidation.sourceNetwork}`);
  console.log(`- destinationNetwork: ${consolidation.destinationNetwork}`);
  console.log(`- amount(base units): ${consolidation.amount}`);
  console.log(`- status: ${consolidation.status}`);
  console.log(`- txHash: ${consolidation.txHash || "-"}`);
  console.log(`- sourceTxHash: ${consolidation.sourceTxHash || "-"}`);
  console.log(`- bridgeTxHash: ${consolidation.bridgeTxHash || "-"}`);
  console.log(`- destinationTxHash: ${consolidation.destinationTxHash || "-"}`);
};

run().catch((error) => {
  console.error("Manual bridge script failed");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
