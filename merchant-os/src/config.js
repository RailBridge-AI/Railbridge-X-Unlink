import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");
const envFilePath = resolve(rootDir, ".env");

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
    // Shell-exported env vars win over .env values.
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

const parseIntEnv = (value, fallback) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const parseBigIntEnv = (value, fallback) => {
  if (value === undefined || value === null) {
    return fallback;
  }
  const text = String(value).trim();
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

const parseRpcUrlList = (value) => {
  if (!value || typeof value !== "string") {
    return [];
  }
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter((item) => item.startsWith("http://") || item.startsWith("https://"));
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
    const urls = parseRpcUrlList(rawValue);
    if (urls.length === 0) {
      return;
    }
    overrides[`eip155:${chainId}`] = urls;
  });

  const rawJson = process.env.MERCHANT_OS_RPC_OVERRIDES_JSON;
  if (rawJson && rawJson.trim()) {
    try {
      const parsed = JSON.parse(rawJson);
      if (parsed && typeof parsed === "object") {
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
            return;
          }
          if (typeof urls === "string") {
            const valid = parseRpcUrlList(urls);
            if (valid.length > 0) {
              overrides[network] = valid;
            }
          }
        });
      }
    } catch {
      // Ignore invalid JSON overrides and keep defaults.
    }
  }

  return overrides;
};

// Static snapshot from Circle supported EVM chains.
// Refresh intentionally if Circle updates supported networks.
const hardcodedUsdcTokenByNetwork = {
  "eip155:1": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "eip155:10": "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
  "eip155:50": "0xfA2958CB79b0491CC627c1557F441eF849Ca8eb1",
  "eip155:51": "0xb5AB69F7bBada22B28e79C8FFAECe55eF1c771D4",
  "eip155:130": "0x078D782b760474a361dDA0AF3839290b0EF57AD6",
  "eip155:137": "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
  "eip155:143": "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
  "eip155:146": "0x29219dd400f2Bf60E5a23d13Be72B486D4038894",
  "eip155:480": "0x79A02482A880bCe3F13E09da970dC34dB4cD24D1",
  "eip155:998": "0x2B3370eE501B4a559b57D449569354196457D8Ab",
  "eip155:999": "0xb88339CB7199b77E23DB6E890353E22632Ba630f",
  "eip155:1301": "0x31d0220469e10c4E71834a79b1f276d740d3768F",
  "eip155:1328": "0x4fCF1784B31630811181f670Aea7A7bEF803eaED",
  "eip155:1329": "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392",
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "eip155:14601": "0x0BA304580ee7c9a980CF72e55f5Ed2E9fd30Bc51",
  "eip155:42161": "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  "eip155:43114": "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
  "eip155:57073": "0x2D270e6886d130D724215A266106e6832161EAEd",
  "eip155:59144": "0x176211869ca2b568f2a7d4ee941e073a821ee1ff",
  "eip155:81224": "0xd996633a415985DBd7D6D12f4A4343E31f5037cf",
  "eip155:98866": "0x222365EF19F7947e5484218551B56bb3965Aa7aF",
  "eip155:4801": "0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88",
  "eip155:10143": "0x534b2f3A21130d7a60830c2Df862319e593943A3",
  "eip155:43113": "0x5425890298aed601595a70AB815c96711a31Bc65",
  "eip155:80002": "0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582",
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "eip155:98867": "0xcB5f30e335672893c7eb944B374c196392C19D18",
  "eip155:59141": "0xfece4462d57bd51a6a552365a011b95f0e16d9b7",
  "eip155:763373": "0xFabab97dCE620294D2B0b0e46C68964e326300Ac",
  "eip155:11155111": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  "eip155:11155420": "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
  "eip155:421614": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  "eip155:5042002": "0x3600000000000000000000000000000000000000",
  "eip155:812242": "0x6d7f141b6819C2c9CC2f818e6ad549E7Ca090F8f"
};

// Static snapshot from Circle supported EVM chains.
const hardcodedRpcByNetwork = {
  "eip155:1": "https://eth.merkle.io",
  "eip155:10": "https://mainnet.optimism.io",
  "eip155:50": "https://erpc.xinfin.network",
  "eip155:51": "https://erpc.apothem.network",
  "eip155:130": "https://rpc.unichain.org",
  "eip155:137": "https://polygon-rpc.com",
  "eip155:143": "https://rpc.monad.xyz",
  "eip155:146": "https://rpc.soniclabs.com",
  "eip155:480": "https://worldchain-mainnet.g.alchemy.com/public",
  "eip155:998": "https://rpc.hyperliquid-testnet.xyz/evm",
  "eip155:999": "https://rpc.hyperliquid.xyz/evm",
  "eip155:1301": "https://sepolia.unichain.org",
  "eip155:1328": "https://evm-rpc-testnet.sei-apis.com",
  "eip155:1329": "https://evm-rpc.sei-apis.com",
  "eip155:8453": "https://mainnet.base.org",
  "eip155:14601": "https://rpc.testnet.soniclabs.com",
  "eip155:42161": "https://arb1.arbitrum.io/rpc",
  "eip155:43114": "https://api.avax.network/ext/bc/C/rpc",
  "eip155:57073": "https://rpc-gel.inkonchain.com",
  "eip155:59144": "https://rpc.linea.build",
  "eip155:81224": "https://rpc.codex.xyz",
  "eip155:98866": "https://rpc.plume.org",
  "eip155:4801": "https://worldchain-sepolia.drpc.org",
  "eip155:10143": "https://testnet-rpc.monad.xyz",
  "eip155:43113": "https://api.avax-test.network/ext/bc/C/rpc",
  "eip155:80002": "https://rpc-amoy.polygon.technology",
  "eip155:84532": "https://sepolia.base.org",
  "eip155:98867": "https://testnet-rpc.plume.org",
  "eip155:59141": "https://rpc.sepolia.linea.build",
  "eip155:763373": "https://rpc-gel-sepolia.inkonchain.com",
  "eip155:11155111": "https://sepolia.drpc.org",
  "eip155:11155420": "https://sepolia.optimism.io",
  "eip155:421614": "https://sepolia-rollup.arbitrum.io/rpc",
  "eip155:5042002": "https://rpc.testnet.arc.network/",
  "eip155:812242": "https://rpc.codex-stg.xyz"
};

const hardcodedRpcUrlsByNetwork = Object.fromEntries(
  Object.entries(hardcodedRpcByNetwork).map(([network, url]) => [network, [url]])
);
const rpcOverridesByNetwork = parseRpcOverridesFromEnv();
const rpcUrlsByNetwork = {
  ...hardcodedRpcUrlsByNetwork,
  ...rpcOverridesByNetwork
};
const resolvedRpcByNetwork = Object.fromEntries(
  Object.entries(rpcUrlsByNetwork).map(([network, urls]) => [network, urls[0]])
);

const defaultUsdcAssets = ["USDC", ...new Set(Object.values(hardcodedUsdcTokenByNetwork))];
const usdcAssetAllowlist = new Set(defaultUsdcAssets.map((asset) => asset.toLowerCase()));

export const config = {
  appName: "railbridge-merchant-os",
  port: parseIntEnv(process.env.MERCHANT_OS_PORT, 4030),
  webUrl: process.env.MERCHANT_OS_WEB_URL || "http://localhost:3000",
  dbPath: resolveDbPath(process.env.MERCHANT_OS_DB_PATH || "data/merchant-os.db"),
  sessionHours: parseIntEnv(process.env.MERCHANT_OS_SESSION_HOURS, 24),
  ingestToken: process.env.MERCHANT_OS_INGEST_TOKEN || "merchant-os-demo-ingest",
  internalToken:
    process.env.MERCHANT_OS_INTERNAL_TOKEN ||
    process.env.MERCHANT_OS_INGEST_TOKEN ||
    "merchant-os-demo-ingest",
  bridgePrivateKey:
    process.env.MERCHANT_OS_BRIDGE_EVM_PRIVATE_KEY ||
    process.env.EVM_PRIVATE_KEY ||
    "",
  gasSponsorPrivateKey:
    process.env.MERCHANT_OS_GAS_SPONSOR_PRIVATE_KEY ||
    "",
  gasSponsorAutoTopupEnabled: process.env.MERCHANT_OS_GAS_SPONSOR_AUTO_TOPUP !== "false",
  gasEstimatorEnabled: process.env.MERCHANT_OS_GAS_ESTIMATOR_ENABLED !== "false",
  gasEstimatorSourceGasUnits: parseIntEnv(process.env.MERCHANT_OS_GAS_ESTIMATOR_SOURCE_GAS_UNITS, 450000),
  gasEstimatorDestinationGasUnits: parseIntEnv(
    process.env.MERCHANT_OS_GAS_ESTIMATOR_DESTINATION_GAS_UNITS,
    350000
  ),
  gasEstimatorBufferBps: parseIntEnv(process.env.MERCHANT_OS_GAS_ESTIMATOR_BUFFER_BPS, 18000),
  gasSponsorTopupWei: parseBigIntEnv(
    process.env.MERCHANT_OS_GAS_SPONSOR_TOPUP_WEI,
    300_000_000_000_000n
  ),
  minBridgeNativeBalanceWei: parseBigIntEnv(
    process.env.MERCHANT_OS_MIN_BRIDGE_NATIVE_BALANCE_WEI,
    100_000_000_000_000n
  ),
  gasSponsorReceiptTimeoutMs: parseIntEnv(process.env.MERCHANT_OS_GAS_SPONSOR_RECEIPT_TIMEOUT_MS, 120000),
  custodyMasterKey: process.env.MERCHANT_OS_CUSTODY_MASTER_KEY || "",
  custodyAddress:
    process.env.MERCHANT_OS_CUSTODY_EVM_ADDRESS ||
    "",
  realConsolidationBridgeEnabled: process.env.MERCHANT_OS_REAL_CONSOLIDATION_BRIDGE !== "false",
  consolidationBridgeTimeoutMs: parseIntEnv(process.env.MERCHANT_OS_CONSOLIDATION_BRIDGE_TIMEOUT_MS, 300000),
  consolidationBridgeRetryAttempts: parseIntEnv(
    process.env.MERCHANT_OS_CONSOLIDATION_BRIDGE_RETRY_ATTEMPTS,
    2
  ),
  consolidationBridgeRetryBackoffMs: parseIntEnv(
    process.env.MERCHANT_OS_CONSOLIDATION_BRIDGE_RETRY_BACKOFF_MS,
    2500
  ),
  consolidationBridgeRpcTimeoutMs: parseIntEnv(
    process.env.MERCHANT_OS_CONSOLIDATION_BRIDGE_RPC_TIMEOUT_MS,
    30000
  ),
  consolidationBridgeRpcRetryCount: parseIntEnv(
    process.env.MERCHANT_OS_CONSOLIDATION_BRIDGE_RPC_RETRY_COUNT,
    3
  ),
  facilitatorAddress:
    process.env.MERCHANT_OS_FACILITATOR_ADDRESS ||
    process.env.FACILITATOR_ADDRESS ||
    "",
  demoSourceNetwork: process.env.MERCHANT_OS_DEMO_SOURCE_NETWORK || "eip155:421614",
  onchainReadTimeoutMs: parseIntEnv(process.env.MERCHANT_OS_ONCHAIN_TIMEOUT_MS, 7000),
  onchainReadTotalBudgetMs: parseIntEnv(process.env.MERCHANT_OS_ONCHAIN_TOTAL_BUDGET_MS, 2200),
  rpcByNetwork: resolvedRpcByNetwork,
  rpcUrlsByNetwork,
  usdcTokenByNetwork: hardcodedUsdcTokenByNetwork,
  usdcAssetAllowlist
};
