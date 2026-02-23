import dotenv from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters } from "viem";
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

const isAddress = (value) => /^0x[a-fA-F0-9]{40}$/.test(value);
const normalizePrivateKey = (value) =>
  typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value.trim()) ? value.trim() : null;

const main = async () => {
  const privateKey = normalizePrivateKey(process.env.EVM_PRIVATE_KEY);
  if (!privateKey) {
    throw new Error("EVM_PRIVATE_KEY is required in facilitator/.env");
  }

  const address = readArg("address") || process.env.REVENUE_REGISTRY_ADDRESS;
  const apiKey = readArg("api-key") || process.env.ARBISCAN_API_KEY || "";
  const ownerArg = readArg("owner");

  if (!address || !isAddress(address)) {
    throw new Error("Provide --address 0x... or set REVENUE_REGISTRY_ADDRESS");
  }
  if (!apiKey) {
    throw new Error("Provide --api-key or set ARBISCAN_API_KEY");
  }

  const deployer = privateKeyToAccount(privateKey);
  const owner =
    (ownerArg && isAddress(ownerArg) ? ownerArg : undefined) ||
    process.env.REVENUE_REGISTRY_OWNER ||
    deployer.address;
  if (!isAddress(owner)) {
    throw new Error("Owner must be a valid EVM address");
  }

  const build = compileRevenueRegistry();
  const ctorArgs = encodeAbiParameters([{ type: "address" }], [owner]).slice(2);

  console.log(`Submitting verification for ${address}...`);
  const submit = await submitVerificationToArbiscan({
    apiKey,
    contractAddress: address,
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
  const result = await waitForVerificationResult({
    apiKey,
    guid: submit.guid
  });
  console.log(`Verification result: ${result}`);
  console.log(`Contract page: https://sepolia.arbiscan.io/address/${address}#code`);
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Verify failed: ${message}`);
  process.exit(1);
});

