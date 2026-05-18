import express from "express";
import { randomUUID } from "node:crypto";
import { x402Facilitator } from "@x402/core/facilitator";
import { PaymentPayload, PaymentRequirements, SettleResponse, SchemeNetworkFacilitator } from "@x402/core/types";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { ExactEvmSchemeV1 } from "@x402/evm/exact/v1/facilitator";
import { ExactEvmSchemeDomainFacilitator } from "./schemes/exact-evm-domain.js";
import { NETWORKS as V1_NETWORKS } from "@x402/evm/v1";
import { createWalletClient, defineChain, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createNonceManager, jsonRpc } from "viem/nonce";
import { Network } from "@x402/core/types";
import { CircleCCTPBridgeService } from "./services/circleCCTPBridgeService.js";
import { MerchantOsPublisher } from "./services/merchantOsPublisher.js";
import { RevenueRegistryRecorder } from "./services/revenueRegistryRecorder.js";
import { extractCrossChainInfo, CROSS_CHAIN } from "./extensions/crossChain.js";
import { CrossChainRouter } from "./schemes/crossChainRouter.js";
import { BridgeJobStore } from "./services/bridgeJobStore.js";
import { BridgeJobWorker } from "./services/bridgeJobWorker.js";
import { FacilitatorChainCatalog } from "./services/facilitatorChainCatalog.js";
import { config } from "./config.js";

// ============================================================================
// EVM Setup
// ============================================================================

// Base account for address logging and non-signing uses.
const evmAccount = privateKeyToAccount(config.EVM_PRIVATE_KEY);
console.info(`✅ EVM Facilitator account: ${evmAccount.address}`);

type EvmChainConfig = {
  network: Network;
  rpcUrl: string;
  chain: ReturnType<typeof defineChain>;
};

const chainCatalog = new FacilitatorChainCatalog();
const syncedChains = chainCatalog.sync();

const buildCctpEvmChains = (): EvmChainConfig[] =>
  syncedChains
    .filter((chain) => chain.status !== "paused")
    .map((chain) => {
      const rpcUrl = chain.rpcEndpoints[0];
      if (!rpcUrl) {
        return null;
      }
      return {
        network: chain.network,
        rpcUrl,
        chain: defineChain({
          id: chain.chainId,
          name: chain.displayName,
          nativeCurrency: {
            name: chain.displayName,
            symbol: "ETH",
            decimals: 18
          },
          rpcUrls: { default: { http: [rpcUrl] } },
          testnet: chain.isTestnet
        })
      };
    })
    .filter((chain): chain is EvmChainConfig => Boolean(chain));

const cctpEvmChains = buildCctpEvmChains();
if (!cctpEvmChains.length) {
  throw new Error("No supported EVM chains found from Circle BridgeKit");
}

const exactSchemesByNetwork = new Map<Network, ExactEvmSchemeDomainFacilitator>();
let v1EvmSigner: ReturnType<typeof toFacilitatorEvmSigner> | null = null;
cctpEvmChains.forEach(({ network, rpcUrl, chain }) => {
  // Create a chain-scoped nonce manager to avoid cross-chain nonce drift.
  const nonceManager = createNonceManager({ source: jsonRpc() });
  const chainAccount = privateKeyToAccount(config.EVM_PRIVATE_KEY, {
    nonceManager,
  });
  const viemClient = createWalletClient({
    account: chainAccount,
    chain,
    transport: http(rpcUrl),
  }).extend(publicActions);
  const feeOverrides =
    config.EVM_MAX_FEE_PER_GAS_WEI || config.EVM_MAX_PRIORITY_FEE_PER_GAS_WEI
      ? {
          ...(config.EVM_MAX_FEE_PER_GAS_WEI
            ? { maxFeePerGas: config.EVM_MAX_FEE_PER_GAS_WEI }
            : {}),
          ...(config.EVM_MAX_PRIORITY_FEE_PER_GAS_WEI
            ? { maxPriorityFeePerGas: config.EVM_MAX_PRIORITY_FEE_PER_GAS_WEI }
            : {}),
        }
      : {};

  const evmSigner = toFacilitatorEvmSigner({
    getCode: (args: { address: `0x${string}` }) => viemClient.getCode(args),
    address: chainAccount.address,
    readContract: (args: {
      address: `0x${string}`;
      abi: readonly unknown[];
      functionName: string;
      args?: readonly unknown[];
    }) =>
      viemClient.readContract({
        ...args,
        args: args.args || [],
      }),
    verifyTypedData: (args: {
      address: `0x${string}`;
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
      signature: `0x${string}`;
    }) => viemClient.verifyTypedData(args as any),
    writeContract: (args: {
      address: `0x${string}`;
      abi: readonly unknown[];
      functionName: string;
      args: readonly unknown[];
      maxFeePerGas?: bigint;
      maxPriorityFeePerGas?: bigint;
    }) =>
      viemClient.writeContract({
        ...args,
        args: args.args || [],
        chain: undefined,
        maxFeePerGas: args.maxFeePerGas ?? feeOverrides.maxFeePerGas,
        maxPriorityFeePerGas:
          args.maxPriorityFeePerGas ?? feeOverrides.maxPriorityFeePerGas,
      }),
    sendTransaction: (args: { to: `0x${string}`; data: `0x${string}` }) =>
      viemClient.sendTransaction({ ...args, chain: undefined }),
    waitForTransactionReceipt: (args: { hash: `0x${string}` }) =>
      viemClient.waitForTransactionReceipt(args),
  });

  exactSchemesByNetwork.set(
    network,
    new ExactEvmSchemeDomainFacilitator(evmSigner, {
      deployERC4337WithEIP6492: config.DEPLOY_ERC4337_WITH_EIP6492,
    }),
  );

  if (!v1EvmSigner) {
    v1EvmSigner = evmSigner;
  }
});

// ============================================================================
// Bridge Service Setup
// ============================================================================

const bridgeService = new CircleCCTPBridgeService({
  provider: "cctp",
  facilitatorAddress: evmAccount.address,
});

const merchantOsPublisher = new MerchantOsPublisher({
  ingestUrl: config.MERCHANT_OS_EVENT_INGEST_URL,
  ingestToken: config.MERCHANT_OS_INGEST_TOKEN,
  merchantContextMapJson: config.MERCHANT_CONTEXT_MAP_JSON,
  defaultContext:
    config.MERCHANT_OS_DEFAULT_MERCHANT_ID && config.MERCHANT_OS_DEFAULT_ACCOUNT_ID
      ? {
          merchantId: config.MERCHANT_OS_DEFAULT_MERCHANT_ID,
          accountId: config.MERCHANT_OS_DEFAULT_ACCOUNT_ID,
        }
      : undefined,
});

const bridgeJobStore = new BridgeJobStore(config.BRIDGE_JOBS_FILE);
const bridgeJobWorker = new BridgeJobWorker({
  store: bridgeJobStore,
  bridgeService,
  merchantOsPublisher,
  intervalMs: config.BRIDGE_WORKER_INTERVAL_MS,
  retryBaseMs: config.BRIDGE_RETRY_BASE_MS
});

const revenueRegistryRecorder = new RevenueRegistryRecorder({
  enabled: config.REVENUE_REGISTRY_ENABLED,
  contractAddress: config.REVENUE_REGISTRY_ADDRESS,
  rpcUrl: config.ARBITRUM_SEPOLIA_RPC_URL,
  privateKey: config.EVM_PRIVATE_KEY
});

if (!config.MERCHANT_OS_EVENT_INGEST_URL) {
  console.warn(
    "[merchant-os] MERCHANT_OS_EVENT_INGEST_URL is not set. Settlement events will not appear in Merchant OS dashboard.",
  );
} else {
  console.info(`[merchant-os] Settlement event ingest enabled: ${config.MERCHANT_OS_EVENT_INGEST_URL}`);
  if (!config.MERCHANT_CONTEXT_MAP_JSON && !config.MERCHANT_OS_DEFAULT_MERCHANT_ID) {
    console.warn(
      "[merchant-os] No merchant context mapping/default configured. If requirements omit merchant metadata, events will be dropped.",
    );
  } else {
    console.info(
      `[merchant-os] Merchant context mode: ${
        config.MERCHANT_CONTEXT_MAP_JSON ? "address_map" : "default_tenant"
      }`,
    );
  }
}

if (revenueRegistryRecorder.isEnabled()) {
  console.info(
    `[revenue-registry] Enabled: ${config.REVENUE_REGISTRY_ADDRESS} (Arbitrum Sepolia)`
  );
} else {
  console.warn(
    "[revenue-registry] Disabled. Set REVENUE_REGISTRY_ADDRESS (and optionally REVENUE_REGISTRY_ENABLED=true) to enable onchain revenue proof."
  );
}

const pickString = (...values: unknown[]): string | undefined =>
  values.find((value): value is string => typeof value === "string" && value.trim() !== "")?.trim();

const extractApiRevenueMeta = (requirements: PaymentRequirements) => {
  const reqAny = requirements as any;
  const reqExtra = reqAny.extra || {};
  const priceExtra = reqAny.price?.extra || {};
  const method = pickString(
    reqAny.method,
    reqExtra.method,
    reqExtra.httpMethod,
    priceExtra.method,
    priceExtra.httpMethod,
  );
  const path = pickString(
    reqAny.resource,
    reqAny.route,
    reqAny.path,
    reqAny.endpoint,
    reqAny.resourcePath,
    reqExtra.route,
    reqExtra.path,
    reqExtra.endpoint,
    reqExtra.apiPath,
    priceExtra.route,
    priceExtra.path,
    priceExtra.endpoint,
    priceExtra.apiPath,
  );

  const derivedRoute = path ? `${method ? `${method.toUpperCase()} ` : ""}${path}` : undefined;
  const apiRoute = pickString(reqExtra.apiRoute, priceExtra.apiRoute, derivedRoute);
  const apiId = pickString(
    reqAny.resourceId,
    reqAny.routeId,
    reqAny.endpointId,
    reqExtra.apiId,
    priceExtra.apiId,
    apiRoute,
  );
  const apiName = pickString(
    reqExtra.apiName,
    reqExtra.name,
    priceExtra.apiName,
    priceExtra.name,
    reqExtra.description,
  );

  return { apiId, apiRoute, apiName };
};

const extractMerchantContextMeta = (requirements: PaymentRequirements) => {
  const reqAny = requirements as any;
  const reqExtra = reqAny.extra || {};
  const priceExtra = reqAny.price?.extra || {};
  const merchantId = pickString(reqExtra.merchantId, priceExtra.merchantId, reqAny.merchantId);
  const accountId = pickString(reqExtra.accountId, priceExtra.accountId, reqAny.accountId);
  return { merchantId, accountId };
};

const normalizeAddress = (value: unknown): `0x${string}` | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(text)) {
    return undefined;
  }
  return text as `0x${string}`;
};

const normalizeBytes32 = (value: unknown): `0x${string}` | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value.trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(text)) {
    return undefined;
  }
  return text as `0x${string}`;
};

// ============================================================================
// Scheme Setup
// ============================================================================

class ExactEvmSchemeRouter implements SchemeNetworkFacilitator {
  readonly scheme = "exact";
  readonly caipFamily = "eip155:*";

  constructor(private schemes: Map<Network, SchemeNetworkFacilitator>) {}

  getExtra(network: Network): Record<string, unknown> | undefined {
    return this.getScheme(network).getExtra(network);
  }

  getSigners(network: Network): string[] {
    return this.getScheme(network).getSigners(network);
  }

  verify(payload: PaymentPayload, requirements: PaymentRequirements) {
    return this.getScheme(requirements.network as Network).verify(payload, requirements);
  }

  settle(payload: PaymentPayload, requirements: PaymentRequirements) {
    return this.getScheme(requirements.network as Network).settle(payload, requirements);
  }

  private getScheme(network: Network): SchemeNetworkFacilitator {
    const scheme = this.schemes.get(network);
    if (!scheme) {
      throw new Error(`Unsupported EVM network: ${network}`);
    }
    return scheme;
  }
}

const evmScheme = new ExactEvmSchemeRouter(exactSchemesByNetwork);

const schemeFacilitators = new Map<string, SchemeNetworkFacilitator>();
schemeFacilitators.set("exact", evmScheme);
// Add more schemes here as they're implemented:
// schemeFacilitators.set("bazaar", bazaarScheme);
// schemeFacilitators.set("subscription", subscriptionScheme);

const crossChainRouter = new CrossChainRouter(schemeFacilitators, bridgeService, {
  isEnabled: config.CROSS_CHAIN_ENABLED,
});

// ============================================================================
// Facilitator Setup with Hooks
// ============================================================================

const facilitator = new x402Facilitator()
  .registerExtension({ key: CROSS_CHAIN })
  .onBeforeVerify(async (context) => {
    console.log("🔍 Before verify:", {
      scheme: context.requirements.scheme,
      network: context.requirements.network,
      payer: context.paymentPayload.payload,
    });

    const sourceNetwork = context.requirements.network as Network;
    if (chainCatalog.isPaused(sourceNetwork)) {
      return { abort: true, reason: `source_network_paused:${sourceNetwork}` };
    }

    // Check bridge liquidity for cross-chain payments
    const crossChainInfo = extractCrossChainInfo(context.paymentPayload);
    if (crossChainInfo && config.CROSS_CHAIN_ENABLED) {
      const sourceAsset = context.requirements.asset;
      const destinationNetwork = crossChainInfo.destinationNetwork as Network;
      const destinationAsset = crossChainInfo.destinationAsset;

      if (chainCatalog.isPaused(destinationNetwork)) {
        return { abort: true, reason: `destination_network_paused:${destinationNetwork}` };
      }

      const hasLiquidity = await bridgeService.checkLiquidity(
        sourceNetwork,
        destinationNetwork,
        sourceAsset,
        context.requirements.amount,
      );

      if (!hasLiquidity) {
        return { abort: true, reason: "insufficient_bridge_liquidity" };
      }

      // Check exchange rate if different assets
      if (sourceAsset !== destinationAsset) {
        const rate = await bridgeService.getExchangeRate(
          sourceNetwork,
          destinationNetwork,
          sourceAsset,
          destinationAsset,
        );

        if (rate <= 0) {
          return { abort: true, reason: "invalid_exchange_rate" };
        }
      }
    }
  })
  .onAfterVerify(async (context) => {
    console.log("✅ After verify:", {
      isValid: context.result.isValid,
      payer: context.result.payer,
    });
  })
  .onVerifyFailure(async (context) => {
    console.error("❌ Verify failure:", {
      error: context.error.message,
      requirements: context.requirements,
    });
  })
  .onBeforeSettle(async (context) => {
    console.log("💰 Before settle:", {
      scheme: context.requirements.scheme,
      network: context.requirements.network,
      amount: context.requirements.amount,
    });

    const crossChainInfo = extractCrossChainInfo(context.paymentPayload);
    if (crossChainInfo) {
      console.log("🌉 Cross-chain payment detected, will settle on source chain:", {
        sourceNetwork: context.requirements.network,
        destinationNetwork: crossChainInfo.destinationNetwork,
        scheme: context.requirements.scheme,
      });
    }
  })
  .onAfterSettle(async (context) => {
    console.log("✅ After settle:", {
      success: context.result.success,
      transaction: context.result.transaction,
      network: context.result.network,
    });

    const crossChainInfo = extractCrossChainInfo(context.paymentPayload);
    const merchantAddress = crossChainInfo?.destinationPayTo || context.requirements.payTo;
    const apiMeta = extractApiRevenueMeta(context.requirements);
    const merchantContextMeta = extractMerchantContextMeta(context.requirements);
    const isCrossChain =
      Boolean(crossChainInfo) &&
      context.result.success &&
      context.result.network !== crossChainInfo?.destinationNetwork &&
      config.CROSS_CHAIN_ENABLED;

    if (context.result.success) {
      const initialStatus = isCrossChain ? "bridge_pending" : "settled_source";
      await merchantOsPublisher.publishSettlementEvent({
        eventId: `${context.result.transaction}:${initialStatus}`,
        merchantAddress,
        sourceNetwork: context.result.network as Network,
        destinationNetwork: crossChainInfo?.destinationNetwork,
        ...apiMeta,
        ...merchantContextMeta,
        asset: context.requirements.asset,
        amount: context.requirements.amount,
        status: initialStatus,
        txHash: context.result.transaction,
        sourceTxHash: context.result.transaction,
        destinationTxHash: isCrossChain ? undefined : context.result.transaction,
        settlementId: context.result.transaction,
      });

      const payer =
        normalizeAddress(context.result.payer) ||
        normalizeAddress((context.paymentPayload as any)?.payload?.authorization?.from) ||
        normalizeAddress((context.paymentPayload as any)?.payload?.from);
      const settlementId = normalizeBytes32(context.result.transaction);
      const sourceTxHash = normalizeBytes32(context.result.transaction);

      if (revenueRegistryRecorder.isEnabled() && payer && settlementId && sourceTxHash) {
        revenueRegistryRecorder
          .recordSettlement({
            settlementId,
            sourceTxHash,
            merchantId: merchantContextMeta.merchantId || "unknown_merchant",
            apiId: apiMeta.apiId || apiMeta.apiRoute || "unknown_api",
            amount: context.requirements.amount,
            payer,
          })
          .then((registryTxHash) => {
            if (!registryTxHash) {
              return;
            }
            console.info("[revenue-registry] Settlement recorded onchain", {
              settlementId,
              registryTxHash,
            });
          })
          .catch((error) => {
            console.error("[revenue-registry] Failed to record settlement onchain", {
              settlementId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
      } else if (revenueRegistryRecorder.isEnabled()) {
        console.warn("[revenue-registry] Skip record: missing payer or tx hash", {
          payer: context.result.payer,
          txHash: context.result.transaction,
        });
      }
    }

    // Queue durable bridge job instead of in-memory async retries.
    if (
      crossChainInfo &&
      context.result.success &&
      context.result.network !== crossChainInfo.destinationNetwork &&
      config.CROSS_CHAIN_ENABLED
    ) {
      const job = bridgeJobStore.enqueue({
        id: randomUUID(),
        settlementId: context.result.transaction,
        merchantAddress: crossChainInfo.destinationPayTo,
        merchantId: merchantContextMeta.merchantId,
        accountId: merchantContextMeta.accountId,
        apiId: apiMeta.apiId,
        apiRoute: apiMeta.apiRoute,
        apiName: apiMeta.apiName,
        sourceNetwork: context.result.network as Network,
        destinationNetwork: crossChainInfo.destinationNetwork as Network,
        destinationAsset: crossChainInfo.destinationAsset,
        amount: context.requirements.amount,
        recipient: crossChainInfo.destinationPayTo,
        sourceTxHash: context.result.transaction,
        maxAttempts: config.BRIDGE_MAX_ATTEMPTS
      });

      console.info("[bridge-worker] queued bridge job", {
        jobId: job.id,
        settlementId: job.settlementId,
        sourceNetwork: job.sourceNetwork,
        destinationNetwork: job.destinationNetwork,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts
      });
    }
  })
  .onSettleFailure(async (context) => {
    console.error("❌ Settle failure:", {
      error: context.error.message,
      requirements: context.requirements,
    });
  });

// ============================================================================
// Register Payment Schemes
// ============================================================================

facilitator.register(
  cctpEvmChains.map((chain) => chain.network),
  evmScheme,
);

if (v1EvmSigner) {
  facilitator.registerV1(
    V1_NETWORKS as any,
    new ExactEvmSchemeV1(v1EvmSigner, {
      deployERC4337WithEIP6492: config.DEPLOY_ERC4337_WITH_EIP6492,
    }),
  );
}

// Note: CrossChainRouter is NOT registered as a scheme
// Cross-chain is extension-based, not scheme-based
// The router is called directly from verify/settle endpoints when extension is detected

console.info("🌉 Cross-chain EVM facilitator initialized");
console.info(`   Cross-chain bridging: ${config.CROSS_CHAIN_ENABLED ? "enabled" : "disabled"}`);
console.info("   'exact' scheme: same-chain payments");
console.info("   Cross-chain: Extension-based routing (any scheme + cross-chain extension)");

// ============================================================================
// Express Server Setup
// ============================================================================

const app = express();
app.use(express.json());

const hasAdminAccess = (authHeader: string | undefined): boolean => {
  if (!config.FACILITATOR_ADMIN_TOKEN) {
    return false;
  }
  if (!authHeader) {
    return false;
  }
  const [scheme, token] = authHeader.split(" ");
  return (scheme || "").toLowerCase() === "bearer" && token === config.FACILITATOR_ADMIN_TOKEN;
};

app.post("/verify", async (req, res) => {
  console.log("📥 POST /verify - Received verify request");
  try {
    const { paymentPayload, paymentRequirements } = req.body as {
      paymentPayload: PaymentPayload;
      paymentRequirements: PaymentRequirements;
    };

    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({
        error: "Missing paymentPayload or paymentRequirements",
      });
    }

    const response = await facilitator.verify(paymentPayload, paymentRequirements);
    res.json(response);
  } catch (error) {
    console.error("Verify error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/settle", async (req, res) => {
  console.log("📥 POST /settle - Received settle request");
  try {
    const { paymentPayload, paymentRequirements } = req.body as {
      paymentPayload: PaymentPayload;
      paymentRequirements: PaymentRequirements;
    };

    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({
        error: "Missing paymentPayload or paymentRequirements",
      });
    }

    const response = await facilitator.settle(paymentPayload, paymentRequirements);

    console.log(`🔍 Settle response:`, {
      success: response.success,
      transaction: response.transaction,
      network: response.network,
      payer: response.payer,
      errorReason: response.errorReason,
    });

    res.json(response);
  } catch (error) {
    console.error("Settle error:", error);

    if (error instanceof Error && error.message.includes("Settlement aborted:")) {
      return res.json({
        success: false,
        errorReason: error.message.replace("Settlement aborted: ", ""),
        network: req.body?.paymentPayload?.network || "unknown",
        transaction: "",
      } as SettleResponse);
    }

    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/supported", async (req, res) => {
  try {
    const response = facilitator.getSupported();
    res.json(response);
  } catch (error) {
    console.error("Supported error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/chains", (_req, res) => {
  res.json({
    items: chainCatalog.list(),
    syncedAt: new Date().toISOString()
  });
});

app.get("/bridge-jobs", (req, res) => {
  if (!hasAdminAccess(req.headers.authorization)) {
    return res.status(401).json({ error: "Unauthorized admin token" });
  }
  res.json({
    items: bridgeJobWorker.listJobs()
  });
});

app.post("/admin/chains/:network/status", (req, res) => {
  if (!hasAdminAccess(req.headers.authorization)) {
    return res.status(401).json({ error: "Unauthorized admin token" });
  }
  const network = String(req.params.network || "").trim() as Network;
  const status = String(req.body?.status || "").trim().toLowerCase();
  if (!network) {
    return res.status(400).json({ error: "network is required" });
  }
  if (!["active", "degraded", "paused"].includes(status)) {
    return res.status(400).json({ error: "status must be active, degraded, or paused" });
  }
  const updated = chainCatalog.setStatus(network, status as "active" | "degraded" | "paused");
  if (!updated) {
    return res.status(404).json({ error: "network not found in chain catalog" });
  }
  res.json({
    success: true,
    item: updated
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    facilitator: "railbridge-cross-chain",
  });
});

app.listen(parseInt(config.PORT), () => {
  bridgeJobWorker.start();
  const syncMs = Math.max(10000, config.CHAIN_SYNC_MS);
  setInterval(() => {
    try {
      const chains = chainCatalog.sync();
      console.info("[facilitator] chain catalog sync complete", {
        count: chains.length
      });
    } catch (error) {
      console.warn("[facilitator] chain sync failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }, syncMs).unref();

  console.log(`🚀 RailBridge Cross-Chain Facilitator listening on port ${config.PORT}`);
  console.log(`📡 Endpoints:`);
  console.log(`   POST /verify - Verify payment payloads`);
  console.log(`   POST /settle - Settle payments on-chain`);
  console.log(`   GET  /supported - Get supported payment kinds`);
  console.log(`   GET  /chains - Circle chain catalog`);
  console.log(`   GET  /bridge-jobs - Durable bridge queue (admin)`);
  console.log(`   GET  /health - Health check`);
});
