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

const PORT = process.env.PORT || "4022";
const CROSS_CHAIN_ENABLED = process.env.CROSS_CHAIN_ENABLED !== "false"; // Default to enabled
const EVM_RPC_URL = process.env.EVM_RPC_URL;
const DEPLOY_ERC4337_WITH_EIP6492 = process.env.DEPLOY_ERC4337_WITH_EIP6492 === "true";
const MERCHANT_OS_EVENT_INGEST_URL = process.env.MERCHANT_OS_EVENT_INGEST_URL;
const MERCHANT_OS_INGEST_TOKEN = process.env.MERCHANT_OS_INGEST_TOKEN;
const MERCHANT_CONTEXT_MAP_JSON = process.env.MERCHANT_CONTEXT_MAP_JSON;
const MERCHANT_OS_DEFAULT_MERCHANT_ID =
  process.env.MERCHANT_OS_DEFAULT_MERCHANT_ID || process.env.MERCHANT_OS_MERCHANT_ID;
const MERCHANT_OS_DEFAULT_ACCOUNT_ID =
  process.env.MERCHANT_OS_DEFAULT_ACCOUNT_ID || process.env.MERCHANT_OS_ACCOUNT_ID;

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
};
