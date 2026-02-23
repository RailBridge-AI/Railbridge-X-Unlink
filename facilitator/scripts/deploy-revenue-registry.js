import dotenv from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, encodeAbiParameters, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  compileRevenueRegistry,
  submitVerificationToArbiscan,
  waitForVerificationResult
} from "./revenue-registry-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const facilitatorRoot = join(__dirname, "..");
const facilitatorEnv = join(facilitatorRoot, ".env");
const merchantOsEnv = join(facilitatorRoot, "..", "merchant-os", ".env");

dotenv.config({ path: facilitatorEnv });
if (existsSync(merchantOsEnv)) {
  const parsed = dotenv.parse(readFileSync(merchantOsEnv, "utf8"));
  Object.entries(parsed).forEach(([key, value]) => {
    if (process.env[key] !== undefined) {
      return;
    }
    if (key.startsWith("MERCHANT_OS_")) {
      process.env[key] = value;
    }
  });
}

const readArg = (name) => {
  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  if (index < 0) {
    return undefined;
  }
  return process.argv[index + 1];
};

const hasFlag = (name) => process.argv.includes(`--${name}`);

const isAddress = (value) => /^0x[a-fA-F0-9]{40}$/.test(value);
const normalizePrivateKey = (value) =>
  typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value.trim()) ? value.trim() : null;

const pickArbRpcUrl = () => {
  const fromArg = readArg("rpc");
  if (fromArg) return fromArg;
  if (process.env.ARBITRUM_SEPOLIA_RPC_URL) return process.env.ARBITRUM_SEPOLIA_RPC_URL;
  const fallbackList = process.env.MERCHANT_OS_RPC_EIP155_421614 || "";
  const first = fallbackList.split(/[\s,]+/).find(Boolean);
  if (first) return first;
  return "https://sepolia-rollup.arbitrum.io/rpc";
};

const main = async () => {
  const privateKey = normalizePrivateKey(process.env.EVM_PRIVATE_KEY);
  if (!privateKey) {
    throw new Error("EVM_PRIVATE_KEY is required in facilitator/.env");
  }

  const rpcUrl = pickArbRpcUrl();
  const shouldVerify = hasFlag("verify");
  const apiKey = readArg("api-key") || process.env.ARBISCAN_API_KEY || "";

  const deployer = privateKeyToAccount(privateKey);
  const ownerArg = readArg("owner");
  const owner =
    (ownerArg && isAddress(ownerArg) ? ownerArg : undefined) ||
    process.env.REVENUE_REGISTRY_OWNER ||
    deployer.address;

  if (!isAddress(owner)) {
    throw new Error("Owner must be a valid EVM address");
  }

  const chain = defineChain({
    id: 421614,
    name: "Arbitrum Sepolia",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: {
      default: { name: "Arbiscan", url: "https://sepolia.arbiscan.io" }
    },
    testnet: true
  });

  const walletClient = createWalletClient({
    account: deployer,
    chain,
    transport: http(rpcUrl)
  });
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl)
  });

  const build = compileRevenueRegistry();

  console.log("Deploying RevenueRegistry...");
  console.log(`RPC: ${rpcUrl}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Owner: ${owner}`);

  const deployTxHash = await walletClient.deployContract({
    abi: build.abi,
    bytecode: build.bytecode,
    args: [owner]
  });

  console.log(`Deployment tx: ${deployTxHash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: deployTxHash });
  const contractAddress = receipt.contractAddress;
  if (!contractAddress) {
    throw new Error("Deployment receipt missing contract address");
  }

  console.log("");
  console.log("RevenueRegistry deployed successfully:");
  console.log(`Address: ${contractAddress}`);
  console.log(`Explorer: https://sepolia.arbiscan.io/address/${contractAddress}`);
  console.log(`Add to env: REVENUE_REGISTRY_ADDRESS=${contractAddress}`);
  console.log(`Optional owner env: REVENUE_REGISTRY_OWNER=${owner}`);

  if (!shouldVerify) {
    return;
  }

  if (!apiKey) {
    throw new Error("ARBISCAN_API_KEY is required for --verify");
  }

  const ctorArgs = encodeAbiParameters([{ type: "address" }], [owner]).slice(2);
  console.log("");
  console.log("Submitting contract verification to Arbiscan...");
  const submit = await submitVerificationToArbiscan({
    apiKey,
    contractAddress,
    constructorArguments: ctorArgs,
    standardInput: build.standardInput,
    compilerVersion: build.compilerVersion
  });

  if (submit.alreadyVerified) {
    console.log("Contract is already verified on Arbiscan.");
    return;
  }

  if (!submit.guid) {
    throw new Error("Missing Arbiscan verification GUID");
  }

  console.log(`Verification GUID: ${submit.guid}`);
  const verifyResult = await waitForVerificationResult({
    apiKey,
    guid: submit.guid
  });
  console.log(`Verification result: ${verifyResult}`);
  console.log(`Contract page: https://sepolia.arbiscan.io/address/${contractAddress}#code`);
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Deploy failed: ${message}`);
  process.exit(1);
});

