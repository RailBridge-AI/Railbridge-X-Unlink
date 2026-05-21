import { BridgeKit } from "@circle-fin/bridge-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, fallback, http } from "viem";
import { config } from "./config.js";

const USDC_SYMBOL = "USDC";
const DEFAULT_RPC_TIMEOUT_MS = 15000;
const DEFAULT_RPC_RETRY_COUNT = 2;
const DEFAULT_RETRY_ATTEMPTS = 2;
const DEFAULT_RETRY_BACKOFF_MS = 2500;
const TRANSIENT_ERROR_PATTERNS = [
  "timeout",
  "timed out",
  "network",
  "temporar",
  "retry",
  "429",
  "502",
  "503",
  "504",
  "econnreset",
  "etimedout",
  "failed to fetch",
  "gateway"
];
const EXTRA_RPC_URLS_BY_CAIP2 = {
  "eip155:84532": [
    "https://sepolia.base.org",
    "https://base-sepolia-rpc.publicnode.com",
    "https://base-sepolia.drpc.org"
  ],
  "eip155:421614": [
    "https://arbitrum-sepolia-rpc.publicnode.com",
    "https://sepolia-rollup.arbitrum.io/rpc",
    "https://arbitrum-sepolia.drpc.org"
  ],
  "eip155:11155111": [
    "https://ethereum-sepolia-rpc.publicnode.com",
    "https://rpc.sepolia.org"
  ],
  "eip155:11155420": [
    "https://optimism-sepolia-rpc.publicnode.com"
  ]
};

const normalizeEvmAddress = (value) => {
  if (!value || typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(text)) {
    return null;
  }
  return text;
};

const normalizePrivateKey = (value) => {
  if (!value || typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(text)) {
    return null;
  }
  return text;
};

const toHumanReadableUsdc = (baseUnits) => {
  const decimals = 6n;
  const base = 10n ** decimals;
  const value = BigInt(baseUnits);
  const integer = value / base;
  const fraction = value % base;

  if (fraction === 0n) {
    return integer.toString();
  }

  let fractionStr = fraction.toString().padStart(Number(decimals), "0");
  fractionStr = fractionStr.replace(/0+$/, "");
  return `${integer}.${fractionStr}`;
};

const parseMessageId = (result) => {
  const step = result?.steps?.find((item) => item?.name === "fetchAttestation");
  const attestation = step?.data?.attestation;
  if (typeof attestation === "string" && attestation.trim()) {
    return attestation;
  }
  return null;
};

const parseBridgeTxHashes = (result) => {
  const burnStep = result?.steps?.find((item) => item?.name === "burn");
  const mintStep = result?.steps?.find((item) => item?.name === "mint");
  const bridgeTxHash =
    typeof burnStep?.txHash === "string" && burnStep.txHash.trim() ? burnStep.txHash.trim() : null;
  const destinationTxHash =
    typeof mintStep?.txHash === "string" && mintStep.txHash.trim() ? mintStep.txHash.trim() : null;
  return {
    bridgeTxHash,
    destinationTxHash
  };
};

const sleep = async (ms) => {
  const delayMs = Math.max(0, Number(ms || 0));
  if (delayMs === 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, delayMs));
};

const asString = (value) => {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return value.message || String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const getFailedStep = (result) =>
  result?.steps?.find((step) => step?.state === "error") || null;

const describeFailedStep = (result) => {
  const failedStep = getFailedStep(result);
  if (!failedStep) {
    return {
      stepName: "unknown_step",
      detail: "BridgeKit returned error state"
    };
  }
  const detail = String(
    failedStep.errorMessage ||
      asString(failedStep.error) ||
      "BridgeKit returned error state"
  ).trim();
  return {
    stepName: failedStep.name || "unknown_step",
    detail
  };
};

const isLikelyTransientError = (result, fallbackMessage = "") => {
  const { detail } = describeFailedStep(result);
  const haystack = `${detail} ${fallbackMessage}`.toLowerCase();
  return TRANSIENT_ERROR_PATTERNS.some((needle) => haystack.includes(needle));
};

const pushUnique = (set, items) => {
  if (!Array.isArray(items)) {
    return;
  }
  items.forEach((item) => {
    if (typeof item !== "string") {
      return;
    }
    const value = item.trim();
    if (!value.startsWith("http://") && !value.startsWith("https://")) {
      return;
    }
    set.add(value);
  });
};

const transportRetryDelay = ({ count }) => Math.min(2000, 350 * (count + 1));

export const resolveBridgeKitChainCaip2 = (chain) => {
  const chainId =
    chain && Number.isInteger(chain.chainId)
      ? chain.chainId
      : chain && Number.isInteger(chain.id)
        ? chain.id
        : null;
  return chainId === null ? null : `eip155:${chainId}`;
};

/** RPC URLs advertised by Circle Bridge Kit for a chain (`rpcEndpoints` on getSupportedChains()). */
export const extractBridgeKitRpcUrls = (chain) => {
  const urls = new Set();
  pushUnique(urls, chain?.rpcEndpoints);
  pushUnique(urls, chain?.rpcUrls?.default?.http);
  pushUnique(urls, chain?.rpcUrls?.public?.http);
  return Array.from(urls);
};

/**
 * Merge RPC candidates for bridge transports.
 * Priority: Bridge Kit endpoints first, then runtime/catalog overrides, then local fallbacks.
 */
export const collectRpcUrlsForBridgeChain = (chain, rpcMaps = {}, options = {}) => {
  const ordered = [];
  const seen = new Set();
  const append = (candidates) => {
    (Array.isArray(candidates) ? candidates : []).forEach((candidate) => {
      const url = String(candidate || "").trim();
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return;
      }
      if (seen.has(url)) {
        return;
      }
      seen.add(url);
      ordered.push(url);
    });
  };

  const caip2 = resolveBridgeKitChainCaip2(chain);
  const rpcUrlsByNetwork = rpcMaps.rpcUrlsByNetwork || {};
  const kitRpc =
    options.bridgeKitRpcUrls ||
    extractBridgeKitRpcUrls(chain);

  append(kitRpc);
  append(caip2 ? rpcUrlsByNetwork[caip2] : null);
  append(caip2 ? EXTRA_RPC_URLS_BY_CAIP2[caip2] : null);

  return ordered;
};

const normalizeLookupKey = (value) => String(value || "").trim().toLowerCase();

const parseBigIntLike = (value) => {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  return null;
};

export const parseEstimatedGasFeeWei = (fees) => {
  if (!fees || typeof fees !== "object") {
    return null;
  }
  const fromFee = parseBigIntLike(fees.fee);
  if (fromFee !== null && fromFee >= 0n) {
    return fromFee;
  }
  const gas = parseBigIntLike(fees.gas);
  const gasPrice = parseBigIntLike(fees.gasPrice);
  if (gas !== null && gasPrice !== null && gas >= 0n && gasPrice >= 0n) {
    return gas * gasPrice;
  }
  return null;
};

export const buildBridgeKitGasEstimateMap = ({ gasFees, resolveNetwork }) => {
  const feesByNetwork = new Map();

  (Array.isArray(gasFees) ? gasFees : []).forEach((entry) => {
    const network = resolveNetwork?.(entry?.blockchain);
    const feeWei = parseEstimatedGasFeeWei(entry?.fees);
    if (!network || feeWei === null || feeWei < 0n) {
      return;
    }

    const current = feesByNetwork.get(network) || {
      network,
      estimatedFeeWei: 0n,
      tokenSymbol: String(entry?.token || "").trim() || null,
      stepNames: []
    };
    current.estimatedFeeWei += feeWei;
    if (typeof entry?.name === "string" && entry.name.trim()) {
      current.stepNames.push(entry.name.trim());
    }
    if (!current.tokenSymbol && typeof entry?.token === "string" && entry.token.trim()) {
      current.tokenSymbol = entry.token.trim();
    }
    feesByNetwork.set(network, current);
  });

  return feesByNetwork;
};

export class ConsolidationBridgeError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ConsolidationBridgeError";
    this.details = details;
  }
}

export class ConsolidationBridgeService {
  constructor() {
    this.kit = new BridgeKit();
    this.chainNameByNetwork = new Map();
    this.networkByChainLookup = new Map();
    this.bridgeKitChainByNetwork = new Map();
    this.bridgeKitRpcUrlsByNetwork = new Map();
    this.rpcTimeoutMs = Math.max(
      1000,
      Number(config.consolidationBridgeRpcTimeoutMs || DEFAULT_RPC_TIMEOUT_MS)
    );
    this.rpcRetryCount = Math.max(
      0,
      Number(config.consolidationBridgeRpcRetryCount || DEFAULT_RPC_RETRY_COUNT)
    );
    this.retryAttempts = Math.max(
      0,
      Number(config.consolidationBridgeRetryAttempts || DEFAULT_RETRY_ATTEMPTS)
    );
    this.retryBackoffMs = Math.max(
      0,
      Number(config.consolidationBridgeRetryBackoffMs || DEFAULT_RETRY_BACKOFF_MS)
    );
    this.bridgeLocks = new Map();

    const supportedEvmChains = this.kit.getSupportedChains({ chainType: "evm" });
    supportedEvmChains.forEach((chain) => {
      if (chain.type !== "evm") {
        return;
      }
      const caip2 = `eip155:${chain.chainId}`;
      const chainName = String(chain.chain || "").trim();
      const displayName = String(chain.name || "").trim();
      const kitRpcUrls = extractBridgeKitRpcUrls(chain);
      this.bridgeKitChainByNetwork.set(caip2, chain);
      if (kitRpcUrls.length) {
        this.bridgeKitRpcUrlsByNetwork.set(caip2, kitRpcUrls);
      }
      this.chainNameByNetwork.set(caip2, chainName);
      if (chainName) {
        this.networkByChainLookup.set(normalizeLookupKey(chainName), caip2);
      }
      if (displayName) {
        this.networkByChainLookup.set(normalizeLookupKey(displayName), caip2);
      }
    });
  }

  supportsNetwork(network) {
    return this.chainNameByNetwork.has(network);
  }

  getBridgeKitChain(network) {
    return this.bridgeKitChainByNetwork.get(network) || null;
  }

  getBridgeKitRpcUrls(network) {
    const cached = this.bridgeKitRpcUrlsByNetwork.get(network);
    if (cached?.length) {
      return [...cached];
    }
    return extractBridgeKitRpcUrls(this.getBridgeKitChain(network));
  }

  rpcUrlsForNetwork(network) {
    const chain = this.getBridgeKitChain(network);
    return collectRpcUrlsForBridgeChain(chain || {}, {
      rpcUrlsByNetwork: config.rpcUrlsByNetwork,
      rpcByNetwork: config.rpcByNetwork
    }, {
      bridgeKitRpcUrls: this.getBridgeKitRpcUrls(network)
    });
  }

  rpcUrlsForChain(chain) {
    const caip2 = resolveBridgeKitChainCaip2(chain);
    return collectRpcUrlsForBridgeChain(chain, {
      rpcUrlsByNetwork: config.rpcUrlsByNetwork,
      rpcByNetwork: config.rpcByNetwork
    }, {
      bridgeKitRpcUrls: caip2 ? this.getBridgeKitRpcUrls(caip2) : extractBridgeKitRpcUrls(chain)
    });
  }

  transportForChain(chain) {
    const urls = this.rpcUrlsForChain(chain);
    const caip2 = resolveBridgeKitChainCaip2(chain);
    if (!urls.length) {
      console.warn("[merchant-os] consolidation bridge has no RPC URLs for chain", {
        caip2,
        chainName: chain?.chain || chain?.name || null
      });
    }
    const buildHttp = (url) =>
      http(url, {
        timeout: this.rpcTimeoutMs,
        retryCount: this.rpcRetryCount,
        retryDelay: transportRetryDelay
      });
    if (urls.length > 1) {
      return fallback(urls.map((url) => buildHttp(url)), {
        rank: false,
        retryCount: this.rpcRetryCount,
        retryDelay: transportRetryDelay
      });
    }
    if (urls.length === 1) {
      return buildHttp(urls[0]);
    }
    throw new Error(
      `No RPC URLs configured for bridge chain ${caip2 || chain?.chain || "unknown"}`
    );
  }

  createAdapter(privateKey) {
    return createViemAdapterFromPrivateKey({
      privateKey,
      getPublicClient: ({ chain }) =>
        createPublicClient({
          chain,
          transport: this.transportForChain(chain)
        }),
      getWalletClient: ({ chain, account }) =>
        createWalletClient({
          chain,
          account,
          transport: this.transportForChain(chain)
        })
    });
  }

  resolveNetworkForBlockchain(blockchain) {
    const fromChainId = blockchain && Number.isInteger(blockchain.chainId)
      ? `eip155:${blockchain.chainId}`
      : null;
    if (fromChainId && this.chainNameByNetwork.has(fromChainId)) {
      return fromChainId;
    }

    const lookupCandidates = [
      normalizeLookupKey(blockchain?.chain),
      normalizeLookupKey(blockchain?.name),
      normalizeLookupKey(blockchain?.title)
    ].filter(Boolean);
    for (const candidate of lookupCandidates) {
      const network = this.networkByChainLookup.get(candidate);
      if (network) {
        return network;
      }
    }

    return null;
  }

  buildBridgeContext({
    sourceNetwork,
    destinationNetwork,
    destinationAddress,
    amount,
    asset,
    sourcePrivateKey,
    destinationPrivateKey
  }) {
    if (!this.supportsNetwork(sourceNetwork) || !this.supportsNetwork(destinationNetwork)) {
      throw new Error(`Unsupported network pair: ${sourceNetwork} -> ${destinationNetwork}`);
    }
    const recipient = normalizeEvmAddress(destinationAddress);
    if (!recipient) {
      throw new Error("Invalid destination address");
    }
    if (!/^[0-9]+$/.test(String(amount || "").trim()) || BigInt(amount) <= 0n) {
      throw new Error("Amount must be a positive base-unit string");
    }
    if (String(asset || USDC_SYMBOL).toUpperCase() !== USDC_SYMBOL) {
      throw new Error("Consolidation bridge only supports USDC");
    }

    const fromChain = this.chainNameByNetwork.get(sourceNetwork);
    const toChain = this.chainNameByNetwork.get(destinationNetwork);
    if (!fromChain || !toChain) {
      throw new Error(`Unsupported network pair: ${sourceNetwork} -> ${destinationNetwork}`);
    }

    const normalizedSourcePrivateKey = normalizePrivateKey(sourcePrivateKey);
    if (!normalizedSourcePrivateKey) {
      throw new Error("Missing or invalid source custody private key");
    }
    const normalizedDestinationPrivateKey =
      normalizePrivateKey(destinationPrivateKey) || normalizedSourcePrivateKey;

    const sourceAdapter = this.createAdapter(normalizedSourcePrivateKey);
    const destinationAdapter = this.createAdapter(normalizedDestinationPrivateKey);
    const sourceSignerAddress = privateKeyToAccount(normalizedSourcePrivateKey).address;
    const destinationSignerAddress = privateKeyToAccount(normalizedDestinationPrivateKey).address;
    const amountHuman = toHumanReadableUsdc(amount);

    return {
      sourceNetwork,
      destinationNetwork,
      recipient,
      amountHuman,
      fromChain,
      toChain,
      sourceAdapter,
      destinationAdapter,
      sourceSignerAddress,
      destinationSignerAddress
    };
  }

  async estimateGasRequirements(params) {
    const context = this.buildBridgeContext(params);
    const estimate = await this.kit.estimate({
      from: {
        adapter: context.sourceAdapter,
        chain: context.fromChain
      },
      to: {
        adapter: context.destinationAdapter,
        chain: context.toChain,
        recipientAddress: context.recipient
      },
      amount: context.amountHuman
    });

    const feesByNetwork = buildBridgeKitGasEstimateMap({
      gasFees: estimate?.gasFees,
      resolveNetwork: (blockchain) => this.resolveNetworkForBlockchain(blockchain)
    });

    return {
      sourceNetwork: feesByNetwork.get(context.sourceNetwork) || null,
      destinationNetwork: feesByNetwork.get(context.destinationNetwork) || null,
      byNetwork: Array.from(feesByNetwork.values()),
      sourceSignerAddress: context.sourceSignerAddress,
      destinationSignerAddress: context.destinationSignerAddress,
      estimate
    };
  }

  async runBridgeWithRetry({ bridgeParams, retryContext }) {
    let result = await this.kit.bridge(bridgeParams);
    let lastRetryError = null;

    for (let attempt = 1; result?.state === "error" && attempt <= this.retryAttempts; attempt += 1) {
      const shouldRetry = isLikelyTransientError(result, lastRetryError || "");
      if (!shouldRetry) {
        break;
      }

      if (attempt > 1) {
        await sleep(this.retryBackoffMs * attempt);
      }
      try {
        result = await this.kit.retry(result, retryContext);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        lastRetryError = message;
        const lowered = message.toLowerCase();
        const blockedByUserAction =
          lowered.includes("requires user action") ||
          lowered.includes("not supported") ||
          lowered.includes("not retryable");
        if (blockedByUserAction) {
          break;
        }
      }
    }

    return { result, lastRetryError };
  }

  async withBridgeLock(lockKey, operation) {
    const previous = this.bridgeLocks.get(lockKey) || Promise.resolve();
    let release = null;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    this.bridgeLocks.set(lockKey, current);
    await previous.catch(() => {});
    try {
      return await operation();
    } finally {
      release();
      if (this.bridgeLocks.get(lockKey) === current) {
        this.bridgeLocks.delete(lockKey);
      }
    }
  }

  async bridge({
    sourceNetwork,
    destinationNetwork,
    destinationAddress,
    amount,
    asset,
    sourcePrivateKey,
    destinationPrivateKey
  }) {
    const context = this.buildBridgeContext({
      sourceNetwork,
      destinationNetwork,
      destinationAddress,
      amount,
      asset,
      sourcePrivateKey,
      destinationPrivateKey
    });

    const lockKey = `${context.sourceSignerAddress.toLowerCase()}::${context.destinationSignerAddress.toLowerCase()}`;

    return this.withBridgeLock(lockKey, async () => {
      const bridgeParams = {
        from: {
          adapter: context.sourceAdapter,
          chain: context.fromChain
        },
        to: {
          adapter: context.destinationAdapter,
          chain: context.toChain,
          recipientAddress: context.recipient
        },
        amount: context.amountHuman
      };
      const retryContext = {
        from: {
          adapter: context.sourceAdapter,
          chain: context.fromChain
        },
        to: {
          adapter: context.destinationAdapter,
          chain: context.toChain
        }
      };
      const { result, lastRetryError } = await this.runBridgeWithRetry({
        bridgeParams,
        retryContext
      });

      if (result?.state === "error") {
        const { stepName, detail } = describeFailedStep(result);
        const failedStep = getFailedStep(result);
        const hashes = parseBridgeTxHashes(result);
        const retrySuffix = lastRetryError ? ` | retry: ${lastRetryError}` : "";
        throw new ConsolidationBridgeError(`Bridge failed at ${stepName}: ${detail}${retrySuffix}`, {
          stepName,
          detail,
          sourceTxHash: hashes.bridgeTxHash || failedStep?.txHash || null,
          bridgeTxHash: hashes.bridgeTxHash || failedStep?.txHash || null,
          destinationTxHash: hashes.destinationTxHash || null,
          failedStepTxHash: failedStep?.txHash || null,
          failedStepExplorerUrl: failedStep?.explorerUrl || null
        });
      }

      const { bridgeTxHash, destinationTxHash } = parseBridgeTxHashes(result);
      if (!bridgeTxHash) {
        throw new ConsolidationBridgeError("Bridge did not return burn transaction hash", {
          sourceTxHash: null,
          bridgeTxHash: null,
          destinationTxHash: destinationTxHash || null
        });
      }

      return {
        sourceTxHash: bridgeTxHash,
        bridgeTxHash,
        destinationTxHash,
        messageId: parseMessageId(result),
        sourceSignerAddress: context.sourceSignerAddress,
        destinationSignerAddress: context.destinationSignerAddress
      };
    });
  }
}
