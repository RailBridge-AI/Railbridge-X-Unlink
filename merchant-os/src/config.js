import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");
const envFilePath = resolve(rootDir, ".env");
const runtimeConfigPath = resolve(rootDir, "config", "runtime-config.json");
const runtimeConfigLocalPath = resolve(rootDir, "config", "runtime-config.local.json");

const loadEnvFile = () => {
  if (!existsSync(envFilePath)) {
    return;
  }

  const raw = readFileSync(envFilePath, "utf8");
  const lines = raw.split(/\r?\n/);
  for (const inputLine of lines) {
    const trimmed = inputLine.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const line = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    if (process.env[key] !== undefined) {
      continue;
    }

    let value = line.slice(separatorIndex + 1).trim();
    const doubleQuoted = value.startsWith('"') && value.endsWith('"');
    const singleQuoted = value.startsWith("'") && value.endsWith("'");

    if (doubleQuoted || singleQuoted) {
      value = value.slice(1, -1);
      if (doubleQuoted) {
        value = value
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\t/g, "\t");
      }
    } else {
      const commentIndex = value.indexOf(" #");
      if (commentIndex >= 0) {
        value = value.slice(0, commentIndex).trim();
      }
    }

    process.env[key] = value;
  }
};

loadEnvFile();

const parseIntValue = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const parseBigIntValue = (value, fallback) => {
  if (value === undefined || value === null) {
    return fallback;
  }
  const text =
    typeof value === "bigint" ? value.toString() : String(value).trim();
  if (!/^[0-9]+$/.test(text)) {
    return fallback;
  }
  try {
    return BigInt(text);
  } catch {
    return fallback;
  }
};

const resolveDbPath = (value) => {
  const raw = String(value || "").trim();
  if (!raw) {
    return join(rootDir, "data", "merchant-os.db");
  }
  return resolve(rootDir, raw);
};

const parseJsonObjectEnv = (value, fallback = {}) => {
  if (!value || typeof value !== "string") {
    return fallback;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const parseCsvList = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const parseStringList = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return parseCsvList(value);
  }
  return [];
};

const parseBooleanValue = (value, fallback) => {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
};

const toPlainObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const readJsonObjectFile = (path) => {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const raw = readFileSync(path, "utf8").trim();
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return toPlainObject(parsed);
  } catch (error) {
    console.warn("[merchant-os] failed to read runtime config", {
      path,
      error: error instanceof Error ? error.message : String(error)
    });
    return {};
  }
};

const normalizeRpcOverrideMap = (input) => {
  const normalized = {};
  const source = toPlainObject(input);

  Object.entries(source).forEach(([network, rawUrls]) => {
    if (!/^eip155:[0-9]+$/.test(network)) {
      return;
    }
    const values = Array.isArray(rawUrls)
      ? rawUrls
      : typeof rawUrls === "string"
      ? rawUrls.split(/[\s,]+/)
      : [];
    const urls = values
      .map((item) => String(item || "").trim())
      .filter((item) => item.startsWith("http://") || item.startsWith("https://"));
    if (urls.length > 0) {
      normalized[network] = urls;
    }
  });

  return normalized;
};

const runtimeConfigDefaults = {
  port: 4030,
  webUrl: "http://localhost:3000",
  dbPath: "data/merchant-os.db",
  sessionHours: 24,
  onboardingAutoApprove: false,
  onboardingAllowlistDomains: [],
  custodyMode: "mpc",
  custodyAddress: "",
  gasSponsorAutoTopupEnabled: true,
  gasEstimatorEnabled: true,
  gasEstimatorSourceGasUnits: 450000,
  gasEstimatorDestinationGasUnits: 350000,
  gasEstimatorBufferBps: 18000,
  gasSponsorTopupWei: "300000000000000",
  minBridgeNativeBalanceWei: "100000000000000",
  gasSponsorReceiptTimeoutMs: 120000,
  realConsolidationBridgeEnabled: true,
  realPayoutsEnabled: true,
  payoutTxTimeoutMs: 120000,
  consolidationBridgeTimeoutMs: 300000,
  consolidationBridgeRetryAttempts: 2,
  consolidationBridgeRetryBackoffMs: 2500,
  consolidationBridgeRpcTimeoutMs: 30000,
  consolidationBridgeRpcRetryCount: 3,
  facilitatorAddress: "",
  demoSourceNetwork: "eip155:421614",
  onchainReadTimeoutMs: 7000,
  onchainReadTotalBudgetMs: 2200,
  chainCatalogSyncMs: 300000,
  chainStatusOverrides: {},
  rpcOverridesByNetwork: {}
};

const runtimeConfigBase = readJsonObjectFile(runtimeConfigPath);
const runtimeConfigLocal = readJsonObjectFile(runtimeConfigLocalPath);
const runtimeConfig = {
  ...runtimeConfigDefaults,
  ...runtimeConfigBase,
  ...runtimeConfigLocal,
  chainStatusOverrides: {
    ...toPlainObject(runtimeConfigDefaults.chainStatusOverrides),
    ...toPlainObject(runtimeConfigBase.chainStatusOverrides),
    ...toPlainObject(runtimeConfigLocal.chainStatusOverrides)
  },
  rpcOverridesByNetwork: {
    ...toPlainObject(runtimeConfigDefaults.rpcOverridesByNetwork),
    ...toPlainObject(runtimeConfigBase.rpcOverridesByNetwork),
    ...toPlainObject(runtimeConfigLocal.rpcOverridesByNetwork)
  }
};

const parseRpcOverridesFromEnv = () => {
  const overrides = {};

  Object.entries(process.env).forEach(([key, rawValue]) => {
    if (!key.startsWith("MERCHANT_OS_RPC_EIP155_")) {
      return;
    }
    const chainId = key.slice("MERCHANT_OS_RPC_EIP155_".length).trim();
    if (!/^[0-9]+$/.test(chainId)) {
      return;
    }
    const urls = String(rawValue || "")
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter((item) => item.startsWith("http://") || item.startsWith("https://"));
    if (urls.length > 0) {
      overrides[`eip155:${chainId}`] = urls;
    }
  });

  const rawJson = process.env.MERCHANT_OS_RPC_OVERRIDES_JSON;
  if (rawJson && rawJson.trim()) {
    const parsed = parseJsonObjectEnv(rawJson, {});
    Object.entries(parsed).forEach(([network, urls]) => {
      if (!/^eip155:[0-9]+$/.test(network)) {
        return;
      }
      if (Array.isArray(urls)) {
        const valid = urls
          .map((item) => String(item || "").trim())
          .filter((item) => item.startsWith("http://") || item.startsWith("https://"));
        if (valid.length > 0) {
          overrides[network] = valid;
        }
      }
    });
  }

  return overrides;
};

const runtimeRpcOverrides = normalizeRpcOverrideMap(runtimeConfig.rpcOverridesByNetwork);
const envRpcOverrides = parseRpcOverridesFromEnv();
const rpcUrlsByNetwork = {
  ...runtimeRpcOverrides,
  ...envRpcOverrides
};
const rpcByNetwork = Object.fromEntries(
  Object.entries(rpcUrlsByNetwork).map(([network, urls]) => [network, urls[0]])
);

const runtimeUsdcTokenByNetwork = {};
const runtimeUsdcAssetAllowlist = new Set(["usdc"]);

const onboardingAllowlistSource =
  process.env.MERCHANT_OS_ONBOARDING_ALLOWLIST_DOMAINS !== undefined
    ? process.env.MERCHANT_OS_ONBOARDING_ALLOWLIST_DOMAINS
    : runtimeConfig.onboardingAllowlistDomains;
const onboardingAllowlistDomains = new Set(
  parseStringList(onboardingAllowlistSource)
    .map((item) => item.toLowerCase())
    .filter(Boolean)
);

const chainStatusOverrides = {
  ...toPlainObject(runtimeConfig.chainStatusOverrides),
  ...parseJsonObjectEnv(process.env.MERCHANT_OS_CHAIN_STATUS_OVERRIDES_JSON, {})
};

const custodyMode = String(
  process.env.MERCHANT_OS_CUSTODY_MODE ?? runtimeConfig.custodyMode ?? "mpc"
)
  .trim()
  .toLowerCase();

export const config = {
  appName: "railbridge-merchant-os",
  port: parseIntValue(process.env.MERCHANT_OS_PORT ?? runtimeConfig.port, 4030),
  webUrl: String(
    (process.env.MERCHANT_OS_WEB_URL ?? runtimeConfig.webUrl) ||
      "http://localhost:3000"
  ),
  dbPath: resolveDbPath(process.env.MERCHANT_OS_DB_PATH ?? runtimeConfig.dbPath ?? "data/merchant-os.db"),
  sessionHours: parseIntValue(process.env.MERCHANT_OS_SESSION_HOURS ?? runtimeConfig.sessionHours, 24),

  ingestToken: process.env.MERCHANT_OS_INGEST_TOKEN || "merchant-os-demo-ingest",
  internalToken:
    process.env.MERCHANT_OS_INTERNAL_TOKEN ||
    process.env.MERCHANT_OS_INGEST_TOKEN ||
    "merchant-os-demo-ingest",
  adminToken: process.env.MERCHANT_OS_ADMIN_TOKEN || "",

  bridgePrivateKey:
    process.env.MERCHANT_OS_BRIDGE_EVM_PRIVATE_KEY ||
    process.env.EVM_PRIVATE_KEY ||
    "",
  gasSponsorPrivateKey: process.env.MERCHANT_OS_GAS_SPONSOR_PRIVATE_KEY || "",
  gasSponsorAutoTopupEnabled: parseBooleanValue(
    process.env.MERCHANT_OS_GAS_SPONSOR_AUTO_TOPUP,
    parseBooleanValue(runtimeConfig.gasSponsorAutoTopupEnabled, true)
  ),
  gasEstimatorEnabled: parseBooleanValue(
    process.env.MERCHANT_OS_GAS_ESTIMATOR_ENABLED,
    parseBooleanValue(runtimeConfig.gasEstimatorEnabled, true)
  ),
  gasEstimatorSourceGasUnits: parseIntValue(
    process.env.MERCHANT_OS_GAS_ESTIMATOR_SOURCE_GAS_UNITS ??
      runtimeConfig.gasEstimatorSourceGasUnits,
    450000
  ),
  gasEstimatorDestinationGasUnits: parseIntValue(
    process.env.MERCHANT_OS_GAS_ESTIMATOR_DESTINATION_GAS_UNITS ??
      runtimeConfig.gasEstimatorDestinationGasUnits,
    350000
  ),
  gasEstimatorBufferBps: parseIntValue(
    process.env.MERCHANT_OS_GAS_ESTIMATOR_BUFFER_BPS ??
      runtimeConfig.gasEstimatorBufferBps,
    18000
  ),
  gasSponsorTopupWei: parseBigIntValue(
    process.env.MERCHANT_OS_GAS_SPONSOR_TOPUP_WEI ??
      runtimeConfig.gasSponsorTopupWei,
    300_000_000_000_000n
  ),
  minBridgeNativeBalanceWei: parseBigIntValue(
    process.env.MERCHANT_OS_MIN_BRIDGE_NATIVE_BALANCE_WEI ??
      runtimeConfig.minBridgeNativeBalanceWei,
    100_000_000_000_000n
  ),
  gasSponsorReceiptTimeoutMs: parseIntValue(
    process.env.MERCHANT_OS_GAS_SPONSOR_RECEIPT_TIMEOUT_MS ??
      runtimeConfig.gasSponsorReceiptTimeoutMs,
    120000
  ),

  mpcCustodyEnabled: custodyMode !== "legacy",
  custodyMasterKey: process.env.MERCHANT_OS_CUSTODY_MASTER_KEY || "",
  custodyAddress: String(
    process.env.MERCHANT_OS_CUSTODY_EVM_ADDRESS ??
      runtimeConfig.custodyAddress ??
      ""
  ),

  realConsolidationBridgeEnabled: parseBooleanValue(
    process.env.MERCHANT_OS_REAL_CONSOLIDATION_BRIDGE,
    parseBooleanValue(runtimeConfig.realConsolidationBridgeEnabled, true)
  ),
  realPayoutsEnabled: parseBooleanValue(
    process.env.MERCHANT_OS_REAL_PAYOUTS_ENABLED,
    parseBooleanValue(runtimeConfig.realPayoutsEnabled, true)
  ),
  payoutTxTimeoutMs: parseIntValue(
    process.env.MERCHANT_OS_PAYOUT_TX_TIMEOUT_MS ??
      runtimeConfig.payoutTxTimeoutMs,
    120000
  ),
  consolidationBridgeTimeoutMs: parseIntValue(
    process.env.MERCHANT_OS_CONSOLIDATION_BRIDGE_TIMEOUT_MS ??
      runtimeConfig.consolidationBridgeTimeoutMs,
    300000
  ),
  consolidationBridgeRetryAttempts: parseIntValue(
    process.env.MERCHANT_OS_CONSOLIDATION_BRIDGE_RETRY_ATTEMPTS ??
      runtimeConfig.consolidationBridgeRetryAttempts,
    2
  ),
  consolidationBridgeRetryBackoffMs: parseIntValue(
    process.env.MERCHANT_OS_CONSOLIDATION_BRIDGE_RETRY_BACKOFF_MS ??
      runtimeConfig.consolidationBridgeRetryBackoffMs,
    2500
  ),
  consolidationBridgeRpcTimeoutMs: parseIntValue(
    process.env.MERCHANT_OS_CONSOLIDATION_BRIDGE_RPC_TIMEOUT_MS ??
      runtimeConfig.consolidationBridgeRpcTimeoutMs,
    30000
  ),
  consolidationBridgeRpcRetryCount: parseIntValue(
    process.env.MERCHANT_OS_CONSOLIDATION_BRIDGE_RPC_RETRY_COUNT ??
      runtimeConfig.consolidationBridgeRpcRetryCount,
    3
  ),

  facilitatorAddress:
    process.env.MERCHANT_OS_FACILITATOR_ADDRESS ||
    process.env.FACILITATOR_ADDRESS ||
    String(runtimeConfig.facilitatorAddress || ""),
  demoSourceNetwork: String(
    process.env.MERCHANT_OS_DEMO_SOURCE_NETWORK ??
      runtimeConfig.demoSourceNetwork ??
      "eip155:421614"
  ),
  onchainReadTimeoutMs: parseIntValue(
    process.env.MERCHANT_OS_ONCHAIN_TIMEOUT_MS ??
      runtimeConfig.onchainReadTimeoutMs,
    7000
  ),
  onchainReadTotalBudgetMs: parseIntValue(
    process.env.MERCHANT_OS_ONCHAIN_TOTAL_BUDGET_MS ??
      runtimeConfig.onchainReadTotalBudgetMs,
    2200
  ),

  chainCatalogSyncMs: parseIntValue(
    process.env.MERCHANT_OS_CHAIN_SYNC_MS ?? runtimeConfig.chainCatalogSyncMs,
    300000
  ),
  chainStatusOverrides,

  onboardingAllowlistDomains,
  onboardingAutoApprove: parseBooleanValue(
    process.env.MERCHANT_OS_ONBOARDING_AUTO_APPROVE,
    parseBooleanValue(runtimeConfig.onboardingAutoApprove, false)
  ),

  rpcByNetwork,
  rpcUrlsByNetwork,
  usdcTokenByNetwork: runtimeUsdcTokenByNetwork,
  usdcAssetAllowlist: runtimeUsdcAssetAllowlist,

  applyChainRuntimeMaps(maps) {
    if (!maps || typeof maps !== "object") {
      return;
    }
    const nextRpcUrlsByNetwork = maps.rpcUrlsByNetwork || {};
    const nextRpcByNetwork = maps.rpcByNetwork || {};
    const nextUsdcTokenByNetwork = maps.usdcTokenByNetwork || {};

    Object.keys(this.rpcUrlsByNetwork).forEach((key) => delete this.rpcUrlsByNetwork[key]);
    Object.keys(nextRpcUrlsByNetwork).forEach((key) => {
      this.rpcUrlsByNetwork[key] = nextRpcUrlsByNetwork[key];
    });

    Object.keys(this.rpcByNetwork).forEach((key) => delete this.rpcByNetwork[key]);
    Object.keys(nextRpcByNetwork).forEach((key) => {
      this.rpcByNetwork[key] = nextRpcByNetwork[key];
    });

    Object.keys(this.usdcTokenByNetwork).forEach((key) => delete this.usdcTokenByNetwork[key]);
    Object.keys(nextUsdcTokenByNetwork).forEach((key) => {
      this.usdcTokenByNetwork[key] = nextUsdcTokenByNetwork[key];
    });

    this.usdcAssetAllowlist.clear();
    this.usdcAssetAllowlist.add("usdc");
    const nextAllowlist = maps.usdcAssetAllowlist;
    if (nextAllowlist && typeof nextAllowlist.forEach === "function") {
      nextAllowlist.forEach((asset) => {
        this.usdcAssetAllowlist.add(String(asset || "").toLowerCase());
      });
    }
  }
};
