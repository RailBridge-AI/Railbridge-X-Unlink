import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { BridgeKit, type EVMChainDefinition } from "@circle-fin/bridge-kit";
import {
  createPublicClient,
  formatEther,
  http,
  keccak256,
  toHex,
  type Address,
} from "viem";
import { hashStruct } from "viem/utils";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactEvmSchemeDomainClient } from "../src/schemes/exact-evm-domain.js";
import type { PaymentRequirements } from "@x402/core/types";
import { privateKeyToAccount } from "viem/accounts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, "..", ".env");
dotenv.config({ path: envPath });

const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:4022";
const MERCHANT_URL = process.env.MERCHANT_URL || "http://localhost:4021";
const CLIENT_PRIVATE_KEY = process.env.CLIENT_PRIVATE_KEY as
  | `0x${string}`
  | undefined;
const FACILITATOR_PRIVATE_KEY = process.env
  .FACILITATOR_EVM_PRIVATE_KEY as `0x${string}` | undefined;

const PAYMENT_AMOUNT = 10000n;
const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
] as const;
const TOKEN_DOMAIN_ABI = [
  {
    name: "name",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "version",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;
const DOMAIN_SEPARATOR_ABI = [
  {
    name: "DOMAIN_SEPARATOR",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

type TestResult = {
  name: string;
  caip2: string;
  rpc: string | null;
  usdcAddress: string | null;
  ok: boolean;
  details?: string;
};
type Caip2 = `${string}:${string}`;

const logSection = (label: string) => {
  console.log(`\n=== ${label} ===`);
};

const logResult = (label: string, value?: string) => {
  if (value) {
    console.log(`   ${label}: ${value}`);
  } else {
    console.log(`   ${label}`);
  }
};

const buildExplorerUrl = (
  explorerUrl: string | null | undefined,
  txHash: string,
) => {
  if (!explorerUrl || !txHash) {
    return null;
  }
  if (explorerUrl.includes("{hash}")) {
    return explorerUrl.replace("{hash}", txHash);
  }
  return `${explorerUrl.replace(/\/$/, "")}/tx/${txHash}`;
};

const checkFacilitatorHealth = async () => {
  try {
    const res = await fetch(`${FACILITATOR_URL}/health`);
    if (!res.ok) {
      return `Facilitator /health failed: ${res.status} ${res.statusText}`;
    }
    return null;
  } catch (error) {
    return `Facilitator /health request failed: ${error instanceof Error ? error.message : error}`;
  }
};

const checkEvmRpc = async (chain: EVMChainDefinition): Promise<string | null> => {
  const rpc = chain.rpcEndpoints?.[0];
  if (!rpc) {
    return "Missing RPC endpoint";
  }
  try {
    const client = createPublicClient({
      chain: {
        id: chain.chainId,
        name: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: { default: { http: [rpc] } },
      },
      transport: http(rpc),
    });
    const chainId = await client.getChainId();
    if (chainId !== chain.chainId) {
      return `RPC chainId mismatch (expected ${chain.chainId}, got ${chainId})`;
    }
    return null;
  } catch (error) {
    return `RPC check failed: ${error instanceof Error ? error.message : error}`;
  }
};

const parseJsonSafe = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const getTestnetFilter = (networks: string[]) => {
  const raw = process.env.TESTNETS;
  if (!raw) return networks;
  const allow = new Set(
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  return networks.filter((network) => allow.has(network));
};

const run = async () => {
  logSection("Facilitator health check");
  const healthError = await checkFacilitatorHealth();
  if (healthError) {
    console.warn(`⚠️  ${healthError}`);
  } else {
    console.log("✅ Facilitator is reachable");
  }

  logSection("BridgeKit testnet coverage");
  const kit = new BridgeKit();
  const chains = kit.getSupportedChains({ chainType: "evm" });
  const testnets = chains
    .filter((chain): chain is EVMChainDefinition => chain.type === "evm")
    .filter((chain) => chain.isTestnet);
  const results: TestResult[] = [];
  const testnetNetworks = getTestnetFilter(
    testnets.map((chain) => `eip155:${chain.chainId}`),
  ) as Caip2[];
  if (!testnetNetworks.length) {
    throw new Error("No testnet networks selected for validation");
  }
  const testnetNetworkSet = new Set(testnetNetworks);
  const explorerByNetwork = new Map<string, string | null>();
  const chainByNetwork = new Map<Caip2, EVMChainDefinition>();

  for (const chain of testnets) {
    const caip2 = `eip155:${chain.chainId}` as Caip2;
    if (!testnetNetworkSet.has(caip2)) {
      continue;
    }

    explorerByNetwork.set(caip2, chain.explorerUrl ?? null);
    chainByNetwork.set(caip2, chain);
    logSection(`RPC check ${chain.name} (${caip2})`);
    const usdcAddress = chain.usdcAddress ?? null;
    let error: string | null = null;

    if (!usdcAddress) {
      error = "Missing USDC address";
    } else {
      error = await checkEvmRpc(chain as EVMChainDefinition);
    }

    results.push({
      name: chain.name,
      caip2,
      rpc: chain.rpcEndpoints?.[0] ?? null,
      usdcAddress,
      ok: !error,
      details: error ?? undefined,
    });
    if (error) {
      logResult("❌ RPC check failed", error);
    } else {
      logResult("✅ RPC check passed");
      logResult("USDC", usdcAddress ?? "unknown");
      logResult("RPC", chain.rpcEndpoints?.[0] ?? "unknown");
    }
  }

  const failed = results.filter((r) => !r.ok);
  const passed = results.filter((r) => r.ok);

  console.log(`✅ Passed: ${passed.length}`);
  console.log(`❌ Failed: ${failed.length}`);

  if (failed.length) {
    logSection("Failures");
    failed.forEach((result) => {
      console.log(
        `- ${result.name} (${result.caip2}): ${result.details ?? "unknown error"}`,
      );
    });
  }

  const passingNetworks = results
    .filter((result) => result.ok)
    .map((result) => result.caip2 as Caip2);

  if (!passingNetworks.length) {
    throw new Error("No passing testnets available for payment attempts");
  }

  logSection("Facilitator support for all testnets");
  const supportedRes = await fetch(`${FACILITATOR_URL}/supported`);
  if (!supportedRes.ok) {
    throw new Error(
      `Facilitator /supported failed: ${supportedRes.status} ${supportedRes.statusText}`,
    );
  }
  const supportedJson = await supportedRes.json();
  const supportedKinds = Array.isArray(supportedJson?.kinds)
    ? supportedJson.kinds
    : [];
  const supportedNetworks = new Set(
    supportedKinds
      .filter((kind: { scheme?: string; network?: string }) => kind.scheme === "exact")
      .map((kind: { network?: string }) => kind.network)
      .filter((network?: string): network is string => Boolean(network)),
  );
  const missingFromFacilitator = testnetNetworks.filter(
    (network) => !supportedNetworks.has(network),
  );
  if (missingFromFacilitator.length) {
    console.error(
      `❌ Facilitator missing testnets: ${missingFromFacilitator.join(", ")}`,
    );
  } else {
    console.log("✅ Facilitator supports all testnets");
  }

  logSection("Merchant supports all testnets");
  const merchantRes = await fetch(`${MERCHANT_URL}/api/premium`);
  if (merchantRes.status !== 402) {
    const body = await merchantRes.text();
    throw new Error(
      `Expected 402 from merchant, got ${merchantRes.status}: ${body}`,
    );
  }
  const merchantBody = parseJsonSafe(await merchantRes.text());
  const httpClient = new x402HTTPClient(
    new x402Client((_version, options) => options[0]),
  );
  const paymentRequired = httpClient.getPaymentRequiredResponse(
    (name) => merchantRes.headers.get(name),
    merchantBody,
  );
  if (!paymentRequired?.accepts?.length) {
    throw new Error("Merchant did not return payment requirements");
  }
  const merchantAccepts = new Map<Caip2, PaymentRequirements>();
  paymentRequired.accepts.forEach((opt: PaymentRequirements) => {
    merchantAccepts.set(opt.network as Caip2, opt);
  });
  const merchantNetworks = new Set(merchantAccepts.keys());
  const missingFromMerchant = testnetNetworks.filter(
    (network) => !merchantNetworks.has(network),
  );
  if (missingFromMerchant.length) {
    console.error(
      `❌ Merchant missing testnets: ${missingFromMerchant.join(", ")}`,
    );
  } else {
    console.log("✅ Merchant supports all testnets");
  }

  logSection("Same-chain payments on each passing testnet");
  if (!CLIENT_PRIVATE_KEY) {
    throw new Error("CLIENT_PRIVATE_KEY is required to run payment tests");
  }
  const signer = privateKeyToAccount(CLIENT_PRIVATE_KEY);
  const facilitatorAccount = FACILITATOR_PRIVATE_KEY
    ? privateKeyToAccount(FACILITATOR_PRIVATE_KEY)
    : null;
  if (!facilitatorAccount) {
    console.warn(
      "⚠️  FACILITATOR_EVM_PRIVATE_KEY not set; skipping facilitator gas balance checks",
    );
  }
  const paymentFailures: string[] = [];

  for (const network of passingNetworks) {
    logSection(`Same-chain payment ${network}`);
    try {
      const accept = merchantAccepts.get(network);
      if (accept) {
        logResult("Requirement asset", accept.asset);
        logResult("Requirement amount", accept.amount);
        logResult("Requirement payTo", accept.payTo);
        logResult(
          "Requirement token",
          `${accept.extra?.name ?? "unknown"}:${accept.extra?.version ?? "unknown"}`,
        );
        if (accept.extra?.domain) {
          logResult(
            "Requirement domain",
            JSON.stringify(accept.extra.domain),
          );
        }
      }
      const chain = chainByNetwork.get(network);
      if (!chain) {
        throw new Error(`Missing chain definition for ${network}`);
      }
      const rpc = chain.rpcEndpoints?.[0];
      if (!rpc) {
        throw new Error(`Missing RPC endpoint for ${network}`);
      }
      const publicClient = createPublicClient({
        chain: {
          id: chain.chainId,
          name: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: { default: { http: [rpc] } },
        },
        transport: http(rpc),
      });

      if (facilitatorAccount) {
        const gasBalance = await publicClient.getBalance({
          address: facilitatorAccount.address as Address,
        });
        logResult(
          "Facilitator gas",
          `${formatEther(gasBalance)} ${chain.nativeCurrency.symbol}`,
        );
        if (gasBalance === 0n) {
          const reason = `facilitator has 0 ${chain.nativeCurrency.symbol} for gas`;
          paymentFailures.push(`${network}: ${reason}`);
          logResult("❌ Payment failed", reason);
          continue;
        }
      }

      const usdcAddress = chain.usdcAddress;
      if (!usdcAddress) {
        const reason = "missing USDC address";
        paymentFailures.push(`${network}: ${reason}`);
        logResult("❌ Payment failed", reason);
        continue;
      }

      try {
        const onChainDomainSeparator = await publicClient.readContract({
          address: usdcAddress as Address,
          abi: DOMAIN_SEPARATOR_ABI,
          functionName: "DOMAIN_SEPARATOR",
        });
        if (
          onChainDomainSeparator ===
          "0x0000000000000000000000000000000000000000000000000000000000000000"
        ) {
          const reason =
            "USDC DOMAIN_SEPARATOR is zero (contract not EIP-712 enabled)";
          paymentFailures.push(`${network}: ${reason}`);
          logResult("❌ Payment failed", reason);
          continue;
        }

        const [tokenName, tokenVersion] = await Promise.all([
          publicClient.readContract({
            address: usdcAddress as Address,
            abi: TOKEN_DOMAIN_ABI,
            functionName: "name",
          }),
          publicClient.readContract({
            address: usdcAddress as Address,
            abi: TOKEN_DOMAIN_ABI,
            functionName: "version",
          }),
        ]);
        logResult("On-chain token", `${tokenName}:${tokenVersion}`);
        if (
          accept?.extra?.name &&
          accept?.extra?.version &&
          (accept.extra.name !== tokenName ||
            accept.extra.version !== tokenVersion)
        ) {
          const reason = `token domain mismatch (merchant ${accept.extra.name}:${accept.extra.version}, on-chain ${tokenName}:${tokenVersion})`;
          paymentFailures.push(`${network}: ${reason}`);
          logResult("❌ Payment failed", reason);
          continue;
        }

        try {
          const chainIdDomainSeparator = hashStruct({
            data: {
              name: tokenName,
              version: tokenVersion,
              chainId: BigInt(chain.chainId),
              verifyingContract: usdcAddress as `0x${string}`,
            },
            primaryType: "EIP712Domain",
            types: {
              EIP712Domain: [
                { name: "name", type: "string" },
                { name: "version", type: "string" },
                { name: "chainId", type: "uint256" },
                { name: "verifyingContract", type: "address" },
              ],
            },
          });
          if (onChainDomainSeparator !== chainIdDomainSeparator) {
            const saltBytes32 = toHex(chain.chainId, { size: 32 });
            const saltDomainSeparator = hashStruct({
              data: {
                name: tokenName,
                version: tokenVersion,
                verifyingContract: usdcAddress as `0x${string}`,
                salt: saltBytes32,
              },
              primaryType: "EIP712Domain",
              types: {
                EIP712Domain: [
                  { name: "name", type: "string" },
                  { name: "version", type: "string" },
                  { name: "verifyingContract", type: "address" },
                  { name: "salt", type: "bytes32" },
                ],
              },
            });
            const saltedMatch = onChainDomainSeparator === saltDomainSeparator;
            const saltedHashMatch =
              onChainDomainSeparator === keccak256(saltBytes32);
            const reason = saltedMatch
              ? `token uses salt-based EIP-712 domain (salt = chainId)`
              : saltedHashMatch
                ? `token uses salted domain (salt = keccak256(chainId))`
                : `token DOMAIN_SEPARATOR mismatch (chainId domain unsupported)`;
            if (!accept?.extra?.domain) {
              paymentFailures.push(`${network}: ${reason}`);
              logResult("❌ Payment failed", reason);
              continue;
            }
            logResult("⚠️  Domain", reason);
          }
        } catch (error) {
          logResult(
            "On-chain domain",
            `failed to read (${error instanceof Error ? error.message : error})`,
          );
        }
      } catch (error) {
        logResult(
          "On-chain token",
          `failed to read (${error instanceof Error ? error.message : error})`,
        );
      }

      const clientUsdcBalance = await publicClient.readContract({
        address: usdcAddress as Address,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [signer.address as Address],
      });
      logResult("Client USDC", clientUsdcBalance.toString());
      if (clientUsdcBalance < PAYMENT_AMOUNT) {
        const reason = `client USDC balance ${clientUsdcBalance} < ${PAYMENT_AMOUNT}`;
        paymentFailures.push(`${network}: ${reason}`);
        logResult("❌ Payment failed", reason);
        continue;
      }

      const client = new x402Client((_x402Version, options) => {
        const match = options.find((opt) => opt.network === network);
        if (!match) {
          throw new Error(`No payment option for ${network}`);
        }
        return match;
      });
      client.register(network, new ExactEvmSchemeDomainClient(signer));
      const httpClient = new x402HTTPClient(client);
      const fetchWithPayment = wrapFetchWithPayment(fetch, client);

      const paidRes = await fetchWithPayment(`${MERCHANT_URL}/api/premium`, {
        method: "GET",
      });
      if (!paidRes.ok) {
        const body = await paidRes.text();
        throw new Error(
          `Payment failed for ${network}: ${paidRes.status} ${paidRes.statusText} ${body}`,
        );
      }
      const txHash =
        paidRes.headers.get("x-payment-transaction") ||
        paidRes.headers.get("x-payment-tx") ||
        paidRes.headers.get("x-payment-transaction-hash") ||
        "";
      const txNetwork = paidRes.headers.get("x-payment-network") || network;
      console.log(`✅ Payment succeeded on ${network}`);
      const settleResponse = httpClient.getPaymentSettleResponse((name) =>
        paidRes.headers.get(name),
      );
      if (settleResponse?.transaction) {
        logResult("Settle transaction", settleResponse.transaction);
        logResult("Settle network", settleResponse.network || txNetwork);
      }
      if (txHash) {
        logResult("Transaction", txHash);
        logResult("Network", txNetwork);
        const explorerUrl = buildExplorerUrl(
          explorerByNetwork.get(network) ?? null,
          txHash,
        );
        if (explorerUrl) {
          logResult("Explorer", explorerUrl);
        }
      } else if (settleResponse?.transaction) {
        const explorerUrl = buildExplorerUrl(
          explorerByNetwork.get(network) ?? null,
          settleResponse.transaction,
        );
        if (explorerUrl) {
          logResult("Explorer", explorerUrl);
        }
      } else {
        logResult("Transaction", "missing response header");
        logResult("Headers", Array.from(paidRes.headers.keys()).join(", "));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      paymentFailures.push(`${network}: ${message}`);
      logResult("❌ Payment failed", message);
      if (typeof error === "object" && error !== null) {
        const maybeResponse = (error as { response?: Response }).response;
        if (maybeResponse) {
          logResult("Status", String(maybeResponse.status));
        }
      }
    }
  }

  if (missingFromFacilitator.length || missingFromMerchant.length) {
    process.exitCode = 1;
  }
  if (failed.length || paymentFailures.length) {
    process.exitCode = 1;
  }
  if (paymentFailures.length) {
    logSection("Payment failures");
    paymentFailures.forEach((entry) => console.log(`- ${entry}`));
  }
};

run().catch((error) => {
  console.error("❌ Testnet coverage failed");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
