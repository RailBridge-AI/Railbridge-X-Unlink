import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
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

const parseIntEnv = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value || "", 10);
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

const parseJsonObject = <T extends Record<string, unknown>>(value: string | undefined, fallback: T): T => {
  if (!value || !value.trim()) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(value) as T;
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const parseBigIntEnv = (value: string | undefined): bigint | undefined => {
  if (!value || !value.trim()) {
    return undefined;
  }
  try {
    return BigInt(value.trim());
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

const parseRpcOverridesFromEnv = (): Record<string, string[]> => {
  const overrides: Record<string, string[]> = {};

  Object.entries(process.env).forEach(([key, rawValue]) => {
    if (!key.startsWith("FACILITATOR_RPC_EIP155_")) {
      return;
    }
    const chainId = key.replace(/^FACILITATOR_RPC_EIP155_/, "").trim();
    if (!/^[0-9]+$/.test(chainId)) {
      return;
    }
    const urls = normalizeRpcUrls(String(rawValue || ""));
    if (urls.length) {
      overrides[`eip155:${chainId}`] = urls;
    }
  });

  const facilitatorJson = parseJsonObject<Record<string, unknown>>(
    process.env.FACILITATOR_RPC_OVERRIDES_JSON,
    {},
  );
  Object.entries(normalizeRpcOverrideMap(facilitatorJson)).forEach(([network, urls]) => {
    overrides[network] = urls;
  });

  return overrides;
};

const runtimeConfigDefaults = {
  evmRpcUrl: "https://sepolia.base.org",
  crossChainEnabled: true,
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
const runtimeEvmRpcUrl = String(runtimeConfig.evmRpcUrl || "").trim();
const EVM_RPC_URL = String(process.env.EVM_RPC_URL || runtimeEvmRpcUrl || "").trim();

const runtimeChainStatusOverrides = toPlainObject(runtimeConfig.chainStatusOverrides);
const envChainStatusOverrides = parseJsonObject<Record<string, string>>(
  process.env.CHAIN_STATUS_OVERRIDES_JSON,
  {},
);
const CHAIN_STATUS_OVERRIDES_JSON = {
  ...runtimeChainStatusOverrides,
  ...envChainStatusOverrides,
} as Record<string, string>;

const runtimeRpcOverrides = normalizeRpcOverrideMap(runtimeConfig.rpcOverridesByNetwork);
const envRpcOverrides = parseRpcOverridesFromEnv();
const RPC_OVERRIDES_BY_NETWORK = {
  ...runtimeRpcOverrides,
  ...envRpcOverrides,
};

const PORT = process.env.PORT || "4022";
const CROSS_CHAIN_ENABLED = parseBoolean(
  process.env.CROSS_CHAIN_ENABLED,
  parseBoolean(runtimeConfig.crossChainEnabled, true),
);
const DEPLOY_ERC4337_WITH_EIP6492 = process.env.DEPLOY_ERC4337_WITH_EIP6492 === "true";
const MERCHANT_OS_EVENT_INGEST_URL = process.env.MERCHANT_OS_EVENT_INGEST_URL;
const MERCHANT_OS_INGEST_TOKEN = process.env.MERCHANT_OS_INGEST_TOKEN;
const MERCHANT_CONTEXT_MAP_JSON = process.env.MERCHANT_CONTEXT_MAP_JSON;
const MERCHANT_OS_DEFAULT_MERCHANT_ID = process.env.MERCHANT_OS_DEFAULT_MERCHANT_ID;
const MERCHANT_OS_DEFAULT_ACCOUNT_ID = process.env.MERCHANT_OS_DEFAULT_ACCOUNT_ID;

const FACILITATOR_DATA_DIR = process.env.FACILITATOR_DATA_DIR || join(process.cwd(), "data");
const BRIDGE_JOBS_FILE = process.env.BRIDGE_JOBS_FILE || join(FACILITATOR_DATA_DIR, "bridge-jobs.json");
const CHAIN_STATUS_FILE = process.env.CHAIN_STATUS_FILE || join(FACILITATOR_DATA_DIR, "chain-status.json");
const EVM_MAX_FEE_PER_GAS_WEI = parseBigIntEnv(process.env.EVM_MAX_FEE_PER_GAS_WEI);
const EVM_MAX_PRIORITY_FEE_PER_GAS_WEI = parseBigIntEnv(
  process.env.EVM_MAX_PRIORITY_FEE_PER_GAS_WEI
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
  BRIDGE_WORKER_INTERVAL_MS: parseIntEnv(process.env.BRIDGE_WORKER_INTERVAL_MS, 4000),
  BRIDGE_RETRY_BASE_MS: parseIntEnv(process.env.BRIDGE_RETRY_BASE_MS, 30000),
  BRIDGE_MAX_ATTEMPTS: parseIntEnv(process.env.BRIDGE_MAX_ATTEMPTS, 5),
  CHAIN_SYNC_MS: parseIntEnv(process.env.CHAIN_SYNC_MS, 300000),

  FACILITATOR_DATA_DIR,
  BRIDGE_JOBS_FILE,
  CHAIN_STATUS_FILE,
  EVM_MAX_FEE_PER_GAS_WEI,
  EVM_MAX_PRIORITY_FEE_PER_GAS_WEI,
};
