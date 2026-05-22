import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFacilitatorEnv } from "./load-env.js";

loadFacilitatorEnv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, "..");

const runtimeConfigPath = join(packageRoot, "config", "runtime-config.json");
const runtimeConfigLocalPath = join(packageRoot, "config", "runtime-config.local.json");

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

const toPlainObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const parseIntValue = (value: unknown, fallback: number): number => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
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

const parseBigIntValue = (value: unknown): bigint | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  const text = typeof value === "bigint" ? value.toString() : String(value).trim();
  if (!text) {
    return undefined;
  }
  try {
    return BigInt(text);
  } catch {
    return undefined;
  }
};

const normalizeRpcUrls = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").trim())
      .filter((item) => item.startsWith("http://") || item.startsWith("https://"));
  }
  if (typeof value === "string") {
    return value
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter((item) => item.startsWith("http://") || item.startsWith("https://"));
  }
  return [];
};

const normalizeRpcOverrideMap = (value: unknown): Record<string, string[]> => {
  const source = toPlainObject(value);
  const next: Record<string, string[]> = {};
  Object.entries(source).forEach(([network, urls]) => {
    if (!/^eip155:[0-9]+$/.test(network)) {
      return;
    }
    const valid = normalizeRpcUrls(urls);
    if (valid.length) {
      next[network] = valid;
    }
  });
  return next;
};

const runtimeConfigDefaults = {
  port: 4022,
  evmRpcUrl: "https://sepolia.base.org",
  crossChainEnabled: true,
  deployErc4337WithEip6492: false,
  merchantOsEventIngestUrl: "",
  merchantContextMapJson: "",
  merchantOsDefaultMerchantId: "",
  merchantOsDefaultAccountId: "",
  facilitatorDataDir: "data",
  bridgeJobsFile: "",
  chainStatusFile: "",
  evmMaxFeePerGasWei: "",
  evmMaxPriorityFeePerGasWei: "",
  bridgeWorkerIntervalMs: 4000,
  bridgeRetryBaseMs: 30000,
  bridgeMaxAttempts: 5,
  chainSyncMs: 300000,
  chainStatusOverrides: {},
  rpcOverridesByNetwork: {},
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
    ...toPlainObject(runtimeConfigLocal.chainStatusOverrides),
  },
  rpcOverridesByNetwork: {
    ...toPlainObject(runtimeConfigDefaults.rpcOverridesByNetwork),
    ...toPlainObject(runtimeConfigBase.rpcOverridesByNetwork),
    ...toPlainObject(runtimeConfigLocal.rpcOverridesByNetwork),
  },
};

const deprecatedNonSecretEnvKeys = [
  "PORT",
  "EVM_RPC_URL",
  "CROSS_CHAIN_ENABLED",
  "DEPLOY_ERC4337_WITH_EIP6492",
  "MERCHANT_OS_EVENT_INGEST_URL",
  "MERCHANT_CONTEXT_MAP_JSON",
  "MERCHANT_OS_DEFAULT_MERCHANT_ID",
  "MERCHANT_OS_DEFAULT_ACCOUNT_ID",
  "FACILITATOR_DATA_DIR",
  "BRIDGE_JOBS_FILE",
  "CHAIN_STATUS_FILE",
  "EVM_MAX_FEE_PER_GAS_WEI",
  "EVM_MAX_PRIORITY_FEE_PER_GAS_WEI",
  "BRIDGE_WORKER_INTERVAL_MS",
  "BRIDGE_RETRY_BASE_MS",
  "BRIDGE_MAX_ATTEMPTS",
  "CHAIN_SYNC_MS",
  "CHAIN_STATUS_OVERRIDES_JSON",
  "FACILITATOR_RPC_OVERRIDES_JSON",
];

const activeDeprecatedKeys = deprecatedNonSecretEnvKeys.filter(
  (key) => process.env[key] !== undefined
);
if (activeDeprecatedKeys.length > 0) {
  console.warn(
    `[facilitator] ignoring deprecated non-secret environment overrides: ${activeDeprecatedKeys.join(", ")}`
  );
}
const hasDeprecatedPerChainRpcEnv = Object.keys(process.env).some((key) =>
  key.startsWith("FACILITATOR_RPC_EIP155_")
);
if (hasDeprecatedPerChainRpcEnv) {
  console.warn(
    "[facilitator] ignoring deprecated FACILITATOR_RPC_EIP155_* env overrides. Use config/runtime-config*.json rpcOverridesByNetwork."
  );
}

const FACILITATOR_EVM_PRIVATE_KEY = process.env
  .FACILITATOR_EVM_PRIVATE_KEY as `0x${string}` | undefined;

if (!FACILITATOR_EVM_PRIVATE_KEY) {
  console.error("❌ FACILITATOR_EVM_PRIVATE_KEY environment variable is required");
  console.error("");
  console.error("📝 To fix this:");
  console.error("   1. Copy env.template to .env:");
  console.error("      cp env.template .env");
  console.error("   2. Edit .env and add your private key:");
  console.error("      FACILITATOR_EVM_PRIVATE_KEY=0xYourPrivateKeyHere");
  console.error("");
  console.error("   Note: Make sure .env is in the facilitator directory");
  process.exit(1);
}
const normalizeJsonString = (value: unknown): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    const text = value.trim();
    return text || undefined;
  }
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
};

const runtimeEvmRpcUrl = String(runtimeConfig.evmRpcUrl || "").trim();
const runtimeDataDirRaw = String(runtimeConfig.facilitatorDataDir || "data").trim() || "data";
const FACILITATOR_DATA_DIR = resolve(process.cwd(), runtimeDataDirRaw);
const bridgeJobsFileRaw = String(runtimeConfig.bridgeJobsFile || "").trim();
const chainStatusFileRaw = String(runtimeConfig.chainStatusFile || "").trim();
const BRIDGE_JOBS_FILE = bridgeJobsFileRaw
  ? resolve(process.cwd(), bridgeJobsFileRaw)
  : join(FACILITATOR_DATA_DIR, "bridge-jobs.json");
const CHAIN_STATUS_FILE = chainStatusFileRaw
  ? resolve(process.cwd(), chainStatusFileRaw)
  : join(FACILITATOR_DATA_DIR, "chain-status.json");

const runtimeChainStatusOverrides = toPlainObject(runtimeConfig.chainStatusOverrides);
const CHAIN_STATUS_OVERRIDES_JSON = Object.fromEntries(
  Object.entries(runtimeChainStatusOverrides).map(([network, status]) => [
    network,
    String(status || "").trim().toLowerCase(),
  ])
) as Record<string, string>;
const RPC_OVERRIDES_BY_NETWORK = normalizeRpcOverrideMap(runtimeConfig.rpcOverridesByNetwork);

const PORT = String(parseIntValue(runtimeConfig.port, 4022));
const CROSS_CHAIN_ENABLED = parseBoolean(runtimeConfig.crossChainEnabled, true);
const EVM_RPC_URL = runtimeEvmRpcUrl;
const DEPLOY_ERC4337_WITH_EIP6492 = parseBoolean(
  runtimeConfig.deployErc4337WithEip6492,
  false
);
const MERCHANT_OS_EVENT_INGEST_URL =
  String(runtimeConfig.merchantOsEventIngestUrl || "").trim() || undefined;
const MERCHANT_OS_INGEST_TOKEN = process.env.MERCHANT_OS_INGEST_TOKEN;
const MERCHANT_CONTEXT_MAP_JSON = normalizeJsonString(runtimeConfig.merchantContextMapJson);
const MERCHANT_OS_DEFAULT_MERCHANT_ID =
  String(runtimeConfig.merchantOsDefaultMerchantId || "").trim() || undefined;
const MERCHANT_OS_DEFAULT_ACCOUNT_ID =
  String(runtimeConfig.merchantOsDefaultAccountId || "").trim() || undefined;

const EVM_MAX_FEE_PER_GAS_WEI = parseBigIntValue(runtimeConfig.evmMaxFeePerGasWei);
const EVM_MAX_PRIORITY_FEE_PER_GAS_WEI = parseBigIntValue(
  runtimeConfig.evmMaxPriorityFeePerGasWei
);

export const config = {
  PORT,
  CROSS_CHAIN_ENABLED,
  FACILITATOR_EVM_PRIVATE_KEY,
  EVM_RPC_URL,
  DEPLOY_ERC4337_WITH_EIP6492,
  MERCHANT_OS_EVENT_INGEST_URL,
  MERCHANT_OS_INGEST_TOKEN,
  MERCHANT_CONTEXT_MAP_JSON,
  MERCHANT_OS_DEFAULT_MERCHANT_ID,
  MERCHANT_OS_DEFAULT_ACCOUNT_ID,

  FACILITATOR_ADMIN_TOKEN: process.env.FACILITATOR_ADMIN_TOKEN || "",
  CHAIN_STATUS_OVERRIDES_JSON,
  RPC_OVERRIDES_BY_NETWORK,
  BRIDGE_WORKER_INTERVAL_MS: parseIntValue(runtimeConfig.bridgeWorkerIntervalMs, 4000),
  BRIDGE_RETRY_BASE_MS: parseIntValue(runtimeConfig.bridgeRetryBaseMs, 30000),
  BRIDGE_MAX_ATTEMPTS: parseIntValue(runtimeConfig.bridgeMaxAttempts, 5),
  CHAIN_SYNC_MS: parseIntValue(runtimeConfig.chainSyncMs, 300000),

  FACILITATOR_DATA_DIR,
  BRIDGE_JOBS_FILE,
  CHAIN_STATUS_FILE,
  EVM_MAX_FEE_PER_GAS_WEI,
  EVM_MAX_PRIORITY_FEE_PER_GAS_WEI,
};
