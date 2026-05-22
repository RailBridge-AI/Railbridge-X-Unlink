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
  allowSimulatedLedgerMutations: false,
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

const nodeEnvNormalized = String(process.env.NODE_ENV || "").trim().toLowerCase();
const isProductionEnv = nodeEnvNormalized === "production";
const isTestEnv = nodeEnvNormalized === "test";

const runtimeRpcOverrides = normalizeRpcOverrideMap(runtimeConfig.rpcOverridesByNetwork);
const rpcUrlsByNetwork = { ...runtimeRpcOverrides };
const rpcByNetwork = Object.fromEntries(
  Object.entries(rpcUrlsByNetwork).map(([network, urls]) => [network, urls[0]])
);

const runtimeUsdcTokenByNetwork = {};
const runtimeUsdcAssetAllowlist = new Set(["usdc"]);

const onboardingAllowlistSource = runtimeConfig.onboardingAllowlistDomains;
const onboardingAllowlistDomains = new Set(
  parseStringList(onboardingAllowlistSource)
    .map((item) => item.toLowerCase())
    .filter(Boolean)
);

const chainStatusOverrides = {
  ...toPlainObject(runtimeConfig.chainStatusOverrides)
};

const custodyMode = String(runtimeConfig.custodyMode ?? "mpc").trim().toLowerCase();

export const config = {
  appName: "railbridge-merchant-os",
  port: parseIntValue(runtimeConfig.port, 4030),
  webUrl: String(
    runtimeConfig.webUrl || "http://localhost:3000"
  ),
  dbPath: resolveDbPath(runtimeConfig.dbPath ?? "data/merchant-os.db"),
  sessionHours: parseIntValue(runtimeConfig.sessionHours, 24),

  ingestToken: process.env.MERCHANT_OS_INGEST_TOKEN || "merchant-os-demo-ingest",
  internalToken:
    process.env.MERCHANT_OS_INTERNAL_TOKEN ||
    process.env.MERCHANT_OS_INGEST_TOKEN ||
    "merchant-os-demo-ingest",
  adminToken: process.env.MERCHANT_OS_ADMIN_TOKEN || "",

  gasSponsorPrivateKey: process.env.MERCHANT_OS_GAS_SPONSOR_PRIVATE_KEY || "",
  gasSponsorAutoTopupEnabled: parseBooleanValue(
    runtimeConfig.gasSponsorAutoTopupEnabled,
    parseBooleanValue(runtimeConfig.gasSponsorAutoTopupEnabled, true)
  ),
  gasEstimatorEnabled: parseBooleanValue(
    runtimeConfig.gasEstimatorEnabled,
    parseBooleanValue(runtimeConfig.gasEstimatorEnabled, true)
  ),
  gasEstimatorSourceGasUnits: parseIntValue(
    runtimeConfig.gasEstimatorSourceGasUnits,
    450000
  ),
  gasEstimatorDestinationGasUnits: parseIntValue(
    runtimeConfig.gasEstimatorDestinationGasUnits,
    350000
  ),
  gasEstimatorBufferBps: parseIntValue(
    runtimeConfig.gasEstimatorBufferBps,
    18000
  ),
  gasSponsorTopupWei: parseBigIntValue(
    runtimeConfig.gasSponsorTopupWei,
    300_000_000_000_000n
  ),
  minBridgeNativeBalanceWei: parseBigIntValue(
    runtimeConfig.minBridgeNativeBalanceWei,
    100_000_000_000_000n
  ),
  gasSponsorReceiptTimeoutMs: parseIntValue(
    runtimeConfig.gasSponsorReceiptTimeoutMs,
    120000
  ),

  mpcCustodyEnabled: custodyMode !== "legacy",
  custodyMasterKey: process.env.MERCHANT_OS_CUSTODY_MASTER_KEY || "",
  custodyAddress: String(runtimeConfig.custodyAddress ?? ""),

  realConsolidationBridgeEnabled: parseBooleanValue(
    runtimeConfig.realConsolidationBridgeEnabled,
    parseBooleanValue(runtimeConfig.realConsolidationBridgeEnabled, true)
  ),
  realPayoutsEnabled: parseBooleanValue(
    runtimeConfig.realPayoutsEnabled,
    parseBooleanValue(runtimeConfig.realPayoutsEnabled, true)
  ),
  allowSimulatedLedgerMutations: parseBooleanValue(
    runtimeConfig.allowSimulatedLedgerMutations,
    parseBooleanValue(runtimeConfig.allowSimulatedLedgerMutations, isTestEnv)
  ),
  payoutTxTimeoutMs: parseIntValue(runtimeConfig.payoutTxTimeoutMs, 120000),
  consolidationBridgeTimeoutMs: parseIntValue(
    runtimeConfig.consolidationBridgeTimeoutMs,
    300000
  ),
  consolidationBridgeRetryAttempts: parseIntValue(
    runtimeConfig.consolidationBridgeRetryAttempts,
    2
  ),
  consolidationBridgeRetryBackoffMs: parseIntValue(
    runtimeConfig.consolidationBridgeRetryBackoffMs,
    2500
  ),
  consolidationBridgeRpcTimeoutMs: parseIntValue(
    runtimeConfig.consolidationBridgeRpcTimeoutMs,
    30000
  ),
  consolidationBridgeRpcRetryCount: parseIntValue(
    runtimeConfig.consolidationBridgeRpcRetryCount,
    3
  ),

  facilitatorAddress: String(runtimeConfig.facilitatorAddress || ""),
  demoSourceNetwork: String(
    runtimeConfig.demoSourceNetwork ?? "eip155:421614"
  ),
  onchainReadTimeoutMs: parseIntValue(runtimeConfig.onchainReadTimeoutMs, 7000),
  onchainReadTotalBudgetMs: parseIntValue(
    runtimeConfig.onchainReadTotalBudgetMs,
    2200
  ),

  chainCatalogSyncMs: parseIntValue(runtimeConfig.chainCatalogSyncMs, 300000),
  chainStatusOverrides,

  onboardingAllowlistDomains,
  onboardingAutoApprove: parseBooleanValue(
    runtimeConfig.onboardingAutoApprove,
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

    const mergedRpcUrlsByNetwork = { ...nextRpcUrlsByNetwork };
    Object.entries(runtimeRpcOverrides).forEach(([network, overrideUrls]) => {
      const catalogUrls = Array.isArray(mergedRpcUrlsByNetwork[network])
        ? mergedRpcUrlsByNetwork[network]
        : [];
      mergedRpcUrlsByNetwork[network] = [
        ...new Set([...overrideUrls, ...catalogUrls].filter(Boolean))
      ];
    });

    Object.keys(this.rpcUrlsByNetwork).forEach((key) => delete this.rpcUrlsByNetwork[key]);
    Object.keys(mergedRpcUrlsByNetwork).forEach((key) => {
      this.rpcUrlsByNetwork[key] = mergedRpcUrlsByNetwork[key];
    });

    Object.keys(this.rpcByNetwork).forEach((key) => delete this.rpcByNetwork[key]);
    Object.keys(this.rpcUrlsByNetwork).forEach((key) => {
      const urls = this.rpcUrlsByNetwork[key];
      if (Array.isArray(urls) && urls.length > 0) {
        this.rpcByNetwork[key] = urls[0];
      }
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

const DEMO_INGEST_TOKEN = "merchant-os-demo-ingest";
const usingDemoIngestToken =
  config.ingestToken === DEMO_INGEST_TOKEN || config.internalToken === DEMO_INGEST_TOKEN;

if (usingDemoIngestToken) {
  const warning =
    "[merchant-os] WARNING: ingest/internal token is using the public demo default. Set MERCHANT_OS_INGEST_TOKEN and MERCHANT_OS_INTERNAL_TOKEN before production use.";
  if (config.realConsolidationBridgeEnabled || config.realPayoutsEnabled) {
    console.error(
      `${warning} Real bridging/payout mode is enabled, refusing to start for safety.`
    );
    process.exit(1);
  }
  console.warn(warning);
}

if (isProductionEnv && !String(config.adminToken || "").trim()) {
  console.warn(
    "[merchant-os] WARNING: MERCHANT_OS_ADMIN_TOKEN is empty. Admin routes will be disabled in production."
  );
}

if (isProductionEnv && (!config.realConsolidationBridgeEnabled || !config.realPayoutsEnabled)) {
  console.error(
    "[merchant-os] FATAL: production mode requires realConsolidationBridgeEnabled=true and realPayoutsEnabled=true."
  );
  process.exit(1);
}

const simulationModeEnabled =
  !config.realConsolidationBridgeEnabled || !config.realPayoutsEnabled;
if (simulationModeEnabled && !config.allowSimulatedLedgerMutations) {
  console.error(
    "[merchant-os] FATAL: simulation ledger mutations are disabled. Set allowSimulatedLedgerMutations=true in runtime-config.local.json only for isolated test/demo environments."
  );
  process.exit(1);
}
