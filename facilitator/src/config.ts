import { join } from "node:path";
import { loadFacilitatorEnv } from "./load-env.js";

loadFacilitatorEnv();

const EVM_PRIVATE_KEY = process.env.EVM_PRIVATE_KEY as `0x${string}` | undefined;

if (!EVM_PRIVATE_KEY) {
  console.error("❌ EVM_PRIVATE_KEY environment variable is required");
  console.error("");
  console.error("📝 To fix this:");
  console.error("   1. Copy env.template to .env:");
  console.error("      cp env.template .env");
  console.error("   2. Edit .env and add your private key:");
  console.error("      EVM_PRIVATE_KEY=0xYourPrivateKeyHere");
  console.error("");
  console.error("   Note: Make sure .env is in the facilitator directory");
  process.exit(1);
}

const parseIntEnv = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isNaN(parsed) ? fallback : parsed;
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

const PORT = process.env.PORT || "4022";
const CROSS_CHAIN_ENABLED = process.env.CROSS_CHAIN_ENABLED !== "false";
const EVM_RPC_URL = process.env.EVM_RPC_URL;
const DEPLOY_ERC4337_WITH_EIP6492 = process.env.DEPLOY_ERC4337_WITH_EIP6492 === "true";
const MERCHANT_OS_EVENT_INGEST_URL = process.env.MERCHANT_OS_EVENT_INGEST_URL;
const MERCHANT_OS_INGEST_TOKEN = process.env.MERCHANT_OS_INGEST_TOKEN;
const MERCHANT_CONTEXT_MAP_JSON = process.env.MERCHANT_CONTEXT_MAP_JSON;
const MERCHANT_OS_DEFAULT_MERCHANT_ID =
  process.env.MERCHANT_OS_DEFAULT_MERCHANT_ID || process.env.MERCHANT_OS_MERCHANT_ID;
const MERCHANT_OS_DEFAULT_ACCOUNT_ID =
  process.env.MERCHANT_OS_DEFAULT_ACCOUNT_ID || process.env.MERCHANT_OS_ACCOUNT_ID;
const ARBITRUM_SEPOLIA_RPC_URL =
  process.env.ARBITRUM_SEPOLIA_RPC_URL ||
  process.env.MERCHANT_OS_RPC_EIP155_421614?.split(/[\s,]+/).find(Boolean) ||
  "https://sepolia-rollup.arbitrum.io/rpc";
const REVENUE_REGISTRY_ADDRESS = process.env.REVENUE_REGISTRY_ADDRESS as `0x${string}` | undefined;
const REVENUE_REGISTRY_ENABLED =
  process.env.REVENUE_REGISTRY_ENABLED === "true" || Boolean(REVENUE_REGISTRY_ADDRESS);
const REVENUE_REGISTRY_OWNER = process.env.REVENUE_REGISTRY_OWNER as `0x${string}` | undefined;
const ARBISCAN_API_KEY = process.env.ARBISCAN_API_KEY;

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
  EVM_PRIVATE_KEY,
  EVM_RPC_URL,
  DEPLOY_ERC4337_WITH_EIP6492,
  MERCHANT_OS_EVENT_INGEST_URL,
  MERCHANT_OS_INGEST_TOKEN,
  MERCHANT_CONTEXT_MAP_JSON,
  MERCHANT_OS_DEFAULT_MERCHANT_ID,
  MERCHANT_OS_DEFAULT_ACCOUNT_ID,
  ARBITRUM_SEPOLIA_RPC_URL,
  REVENUE_REGISTRY_ADDRESS,
  REVENUE_REGISTRY_ENABLED,
  REVENUE_REGISTRY_OWNER,
  ARBISCAN_API_KEY,

  FACILITATOR_ADMIN_TOKEN: process.env.FACILITATOR_ADMIN_TOKEN || "",
  CHAIN_STATUS_OVERRIDES_JSON: parseJsonObject<Record<string, string>>(
    process.env.CHAIN_STATUS_OVERRIDES_JSON,
    {}
  ),
  BRIDGE_WORKER_INTERVAL_MS: parseIntEnv(process.env.BRIDGE_WORKER_INTERVAL_MS, 4000),
  BRIDGE_RETRY_BASE_MS: parseIntEnv(process.env.BRIDGE_RETRY_BASE_MS, 30000),
  BRIDGE_MAX_ATTEMPTS: parseIntEnv(process.env.BRIDGE_MAX_ATTEMPTS, 5),
  CHAIN_SYNC_MS: parseIntEnv(process.env.CHAIN_SYNC_MS, 300000),

  FACILITATOR_DATA_DIR,
  BRIDGE_JOBS_FILE,
  CHAIN_STATUS_FILE,
  EVM_MAX_FEE_PER_GAS_WEI,
  EVM_MAX_PRIORITY_FEE_PER_GAS_WEI
};
