import { createServer } from "node:http";
import { URL } from "node:url";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, sep } from "node:path";
import { createReadStream, existsSync, statSync } from "node:fs";
import { config } from "./config.js";
import {
  fetchOnchainGasPrice,
  fetchOnchainNativeBalance,
  fetchOnchainUsdcBalancesByNetwork
} from "./onchain.js";
import { ConsolidationBridgeError, ConsolidationBridgeService } from "./consolidationBridgeService.js";
import { GasSponsorService } from "./gasSponsorService.js";
import {
  authenticateUser,
  createApiProduct,
  createConsolidation,
  createPayoutRequest,
  createSession,
  getApiProductById,
  getApiProductByMethodPath,
  getApiRevenueBreakdown,
  getAvailableBalanceForNetwork,
  getBalances,
  getConsolidation,
  getCustodyPrivateKeyByReference,
  getDemoMerchants,
  hasSettlementLifecycleEvent,
  getPayoutRequest,
  getPolicy,
  getSession,
  getTimeline,
  getWalletByNetwork,
  getWallets,
  hasSettlementEvent,
  initializeDatabase,
  insertSettlementEvent,
  listApiProducts,
  recomputeBalances,
  updateApiProduct,
  updateConsolidationStatus,
  updatePayoutStatus,
  upsertPolicy
} from "./db.js";
import {
  newId,
  nowIso,
  parsePositiveBigInt,
  parsePositiveUsdcToBaseUnits,
  toDecimalUsdcString
} from "./utils.js";

const ACCOUNT_ROUTE =
  /^\/v1\/demo\/merchant\/([^/]+)\/accounts\/([^/]+)\/(overview|settlements|policy|consolidations|payouts|api-revenue)$/;
const API_PRODUCTS_ROUTE = /^\/v1\/demo\/merchant\/([^/]+)\/accounts\/([^/]+)\/api-products(?:\/([^/]+))?$/;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, "..", "public");

const MIME_TYPES = {
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

// EIP-3009 domain parameters are token-contract specific.
// Most Circle-issued USDC contracts use "USD Coin"/"2".
// Arc testnet (0x3600...) has historically required "USDC"/"2" in this demo flow.
const USDC_EIP712_DOMAIN_BY_NETWORK = {
  "eip155:5042002": { name: "USDC", version: "2" }
};

const resolveUsdcDomainProfile = (network) =>
  USDC_EIP712_DOMAIN_BY_NETWORK[network] || { name: "USD Coin", version: "2" };

const isUsdcAsset = (asset) => {
  if (!asset) {
    return false;
  }
  const normalized = String(asset).toLowerCase();
  return normalized === "usdc" || config.usdcAssetAllowlist.has(normalized);
};

const normalizeUsdcAsset = (asset) => {
  if (!isUsdcAsset(asset)) {
    return null;
  }
  return "USDC";
};

const normalizeHttpMethod = (method) => String(method || "").trim().toUpperCase();

const normalizeRoutePath = (path) => {
  const value = String(path || "").trim();
  if (!value) {
    return "";
  }
  return value.startsWith("/") ? value : `/${value}`;
};

const normalizeOptionalAddress = (value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const text = String(value).trim();
  return text === "" ? null : text;
};

const parseJsonBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new Error("Invalid JSON body");
  }
};

const sendJson = (res, statusCode, body) => {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(body));
};

const getBearerToken = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return null;
  }
  const [scheme, token] = authHeader.split(" ");
  if ((scheme || "").toLowerCase() !== "bearer" || !token) {
    return null;
  }
  return token.trim();
};

const requireSession = (req, res) => {
  const token = getBearerToken(req);
  const session = getSession(token);
  if (!session) {
    sendJson(res, 401, { error: "Unauthorized" });
    return null;
  }
  return session;
};

const requireTenant = (res, session, merchantId, accountId) => {
  if (session.merchantId !== merchantId || session.accountId !== accountId) {
    sendJson(res, 403, { error: "Forbidden: tenant scope mismatch" });
    return false;
  }
  return true;
};

const ensureAccountExists = (res, merchantId, accountId) => {
  const wallets = getWallets(merchantId, accountId);
  if (!wallets.length) {
    sendJson(res, 404, { error: "Merchant account not found" });
    return null;
  }
  return wallets;
};

const buildOverviewResponse = async (merchantId, accountId) => {
  const projectedBalances = getBalances(merchantId, accountId);
  const policy = getPolicy(merchantId, accountId);
  const wallets = getWallets(merchantId, accountId);
  const projectedByNetwork = new Map(
    projectedBalances.map((row) => [
      row.network,
      {
        amount: row.amount,
        updatedAt: row.updatedAt
      }
    ])
  );
  const onchainByNetwork = await fetchOnchainUsdcBalancesByNetwork({
    wallets,
    rpcByNetwork: config.rpcByNetwork,
    rpcUrlsByNetwork: config.rpcUrlsByNetwork,
    usdcTokenByNetwork: config.usdcTokenByNetwork,
    timeoutMs: config.onchainReadTimeoutMs,
    totalBudgetMs: config.onchainReadTotalBudgetMs
  });

  const parseBaseUnits = (value) => {
    try {
      return BigInt(String(value || "0"));
    } catch {
      return 0n;
    }
  };

  const mergedByNetwork = new Map();
  wallets.forEach((wallet) => {
    if (!mergedByNetwork.has(wallet.network)) {
      const onchain = onchainByNetwork.get(wallet.network);
      const projected = projectedByNetwork.get(wallet.network);
      let amount = "0";
      let balanceSource = "none";
      let updatedAt = nowIso();

      if (onchain && projected) {
        const onchainAmount = parseBaseUnits(onchain.amount);
        const projectedAmount = parseBaseUnits(projected.amount);
        if (onchainAmount === 0n && projectedAmount > 0n) {
          amount = projected.amount;
          balanceSource = "projected";
          updatedAt = projected.updatedAt || onchain.asOf || nowIso();
        } else {
          amount = onchain.amount;
          balanceSource = "onchain";
          updatedAt = onchain.asOf || projected.updatedAt || nowIso();
        }
      } else if (onchain) {
        amount = onchain.amount;
        balanceSource = "onchain";
        updatedAt = onchain.asOf || nowIso();
      } else if (projected) {
        amount = projected.amount;
        balanceSource = "projected";
        updatedAt = projected.updatedAt || nowIso();
      }
      mergedByNetwork.set(wallet.network, {
        network: wallet.network,
        asset: "USDC",
        amount,
        decimals: 6,
        usdValue: toDecimalUsdcString(amount),
        balanceSource,
        updatedAt
      });
    }
  });

  const balances = [...mergedByNetwork.values()];
  const unifiedUsd = balances.reduce((sum, row) => sum + BigInt(row.amount), 0n);

  return {
    merchantId,
    accountId,
    asOf: nowIso(),
    unifiedUsd: (Number(unifiedUsd) / 1_000_000).toFixed(2),
    policy,
    custody: {
      mode: "custodial",
      wallets: wallets.map((wallet) => ({
        network: wallet.network,
        asset: wallet.asset,
        address: wallet.address
      }))
    },
    balances: balances.map((balance) => ({
      network: balance.network,
      asset: balance.asset,
      amount: balance.amount,
      decimals: 6,
      usdValue: balance.usdValue,
      source: balance.balanceSource,
      updatedAt: balance.updatedAt
    }))
  };
};

const validateIngestToken = (req) => {
  const headerToken = req.headers["x-merchant-os-ingest-token"];
  if (typeof headerToken === "string" && headerToken === config.ingestToken) {
    return true;
  }

  const bearer = getBearerToken(req);
  return Boolean(bearer && bearer === config.ingestToken);
};

const validateInternalToken = (req) => {
  const headerToken = req.headers["x-merchant-os-internal-token"];
  if (typeof headerToken === "string" && headerToken === config.internalToken) {
    return true;
  }
  const ingestToken = req.headers["x-merchant-os-ingest-token"];
  if (typeof ingestToken === "string" && ingestToken === config.internalToken) {
    return true;
  }
  const bearer = getBearerToken(req);
  return Boolean(bearer && bearer === config.internalToken);
};

const consolidationBridgeService = new ConsolidationBridgeService();
const gasSponsorService = new GasSponsorService({
  privateKey: config.gasSponsorPrivateKey,
  rpcByNetwork: config.rpcByNetwork,
  rpcUrlsByNetwork: config.rpcUrlsByNetwork
});

if (config.realConsolidationBridgeEnabled) {
  console.info(
    "[merchant-os] Real consolidation bridge enabled (custody-key managed source/destination signers)."
  );
  if (config.gasSponsorAutoTopupEnabled) {
    if (gasSponsorService.isReady()) {
      console.info("[merchant-os] Gas sponsor auto-topup enabled", {
        sponsorAddress: gasSponsorService.getSponsorAddress()
      });
    } else {
      console.warn(
        "[merchant-os] Gas sponsor auto-topup requested but sponsor key is missing. Set MERCHANT_OS_GAS_SPONSOR_PRIVATE_KEY."
      );
    }
  }
}

const sanitizeFailReason = (value) => {
  const text = String(value || "").trim();
  if (!text) {
    return "bridge_failed";
  }
  if (text.length <= 300) {
    return text;
  }
  return `${text.slice(0, 297)}...`;
};

const MIN_BRIDGE_NATIVE_BALANCE_WEI = config.minBridgeNativeBalanceWei;

const formatNativeAmount = (baseUnits) => {
  const value = BigInt(baseUnits || "0");
  const integer = value / 1_000_000_000_000_000_000n;
  const fraction = value % 1_000_000_000_000_000_000n;
  if (fraction === 0n) {
    return integer.toString();
  }
  let fractionText = fraction.toString().padStart(18, "0").replace(/0+$/, "");
  if (fractionText.length > 6) {
    fractionText = fractionText.slice(0, 6);
  }
  return `${integer}.${fractionText}`;
};

const resolveGasEstimatorProfile = (role) => {
  const sourceUnits = Math.max(21000, Number(config.gasEstimatorSourceGasUnits || 450000));
  const destinationUnits = Math.max(21000, Number(config.gasEstimatorDestinationGasUnits || 350000));
  const rawBufferBps = Number(config.gasEstimatorBufferBps || 18000);
  const bufferBps = Math.max(10000, Number.isFinite(rawBufferBps) ? rawBufferBps : 18000);

  return {
    gasUnits: BigInt(role === "source" ? sourceUnits : destinationUnits),
    bufferBps
  };
};

const estimateRequiredBridgeGas = async ({
  network,
  role
}) => {
  const profile = resolveGasEstimatorProfile(role);

  if (!config.gasEstimatorEnabled) {
    return {
      mode: "static_fallback",
      network,
      role,
      requiredWei: MIN_BRIDGE_NATIVE_BALANCE_WEI,
      gasPriceWei: null,
      gasUnits: profile.gasUnits,
      bufferBps: profile.bufferBps
    };
  }

  const gasPrice = await fetchOnchainGasPrice({
    network,
    rpcByNetwork: config.rpcByNetwork,
    rpcUrlsByNetwork: config.rpcUrlsByNetwork,
    timeoutMs: config.onchainReadTimeoutMs
  });

  if (!gasPrice) {
    return {
      mode: "gas_price_unavailable_fallback",
      network,
      role,
      requiredWei: MIN_BRIDGE_NATIVE_BALANCE_WEI,
      gasPriceWei: null,
      gasUnits: profile.gasUnits,
      bufferBps: profile.bufferBps
    };
  }

  const gasPriceWei = BigInt(gasPrice.gasPriceWei);
  let dynamicRequiredWei = (gasPriceWei * profile.gasUnits * BigInt(profile.bufferBps)) / 10000n;
  if (dynamicRequiredWei < MIN_BRIDGE_NATIVE_BALANCE_WEI) {
    dynamicRequiredWei = MIN_BRIDGE_NATIVE_BALANCE_WEI;
  }

  return {
    mode: "dynamic",
    network,
    role,
    requiredWei: dynamicRequiredWei,
    gasPriceWei,
    gasUnits: profile.gasUnits,
    bufferBps: profile.bufferBps
  };
};

const ensureNetworkGasForBridge = async ({
  network,
  walletAddress,
  currentWei,
  role,
  gasRequirement
}) => {
  const minimumWei = gasRequirement?.requiredWei || MIN_BRIDGE_NATIVE_BALANCE_WEI;
  const estimatorMode = gasRequirement?.mode || "static_fallback";
  const estimatorGasPriceWei = gasRequirement?.gasPriceWei || null;
  const estimatorGasUnits = gasRequirement?.gasUnits || null;
  const estimatorBufferBps = gasRequirement?.bufferBps || null;

  if (currentWei >= minimumWei) {
    return {
      ok: true,
      availableWei: currentWei,
      availableNative: formatNativeAmount(currentWei),
      requiredWei: minimumWei,
      requiredNative: formatNativeAmount(minimumWei),
      estimatorMode,
      toppedUp: false
    };
  }

  if (!config.gasSponsorAutoTopupEnabled) {
    return {
      ok: false,
      error: `insufficient ${role}-network native gas funds for bridge`,
      network,
      address: walletAddress,
      minimumWei: minimumWei.toString(),
      availableWei: currentWei.toString(),
      minimumNative: formatNativeAmount(minimumWei),
      availableNative: formatNativeAmount(currentWei),
      estimatorMode,
      estimatorGasPriceWei: estimatorGasPriceWei ? estimatorGasPriceWei.toString() : null,
      estimatorGasUnits: estimatorGasUnits ? estimatorGasUnits.toString() : null,
      estimatorBufferBps,
      gasSponsorAutoTopupEnabled: false
    };
  }

  if (!gasSponsorService.isReady()) {
    return {
      ok: false,
      error: "gas sponsor auto-topup is enabled but sponsor key is not configured",
      network,
      address: walletAddress,
      minimumWei: minimumWei.toString(),
      availableWei: currentWei.toString(),
      minimumNative: formatNativeAmount(minimumWei),
      availableNative: formatNativeAmount(currentWei)
    };
  }

  if (!gasSponsorService.supportsNetwork(network)) {
    return {
      ok: false,
      error: "gas sponsor does not support this network",
      network,
      address: walletAddress
    };
  }

  const deficitWei = minimumWei - currentWei;
  const topupFloorWei = config.gasSponsorTopupWei > 0n ? config.gasSponsorTopupWei : 0n;
  const topUpAmountWei = deficitWei > topupFloorWei ? deficitWei : topupFloorWei || deficitWei;

  try {
    const topUp = await gasSponsorService.topUp({
      network,
      to: walletAddress,
      amountWei: topUpAmountWei,
      receiptTimeoutMs: config.gasSponsorReceiptTimeoutMs
    });

    if (topUp?.skipped && topUp.reason === "target_is_sponsor") {
      return {
        ok: false,
        error: "gas sponsor wallet is the same as custody wallet; cannot self-top-up",
        network,
        address: walletAddress,
        sponsorAddress: topUp.sponsorAddress
      };
    }

    const updated = await fetchOnchainNativeBalance({
      network,
      address: walletAddress,
      rpcByNetwork: config.rpcByNetwork,
      rpcUrlsByNetwork: config.rpcUrlsByNetwork,
      timeoutMs: config.onchainReadTimeoutMs
    });
    if (!updated) {
      return {
        ok: false,
        error: "gas top-up sent but unable to verify updated native balance",
        network,
        address: walletAddress,
        topUpTxHash: topUp?.txHash || null
      };
    }

    const updatedWei = BigInt(updated.amount);
    if (updatedWei < minimumWei) {
      return {
        ok: false,
        error: "gas top-up confirmed but balance is still below minimum bridge threshold",
        network,
        address: walletAddress,
        topUpTxHash: topUp?.txHash || null,
        minimumWei: minimumWei.toString(),
        availableWei: updatedWei.toString(),
        minimumNative: formatNativeAmount(minimumWei),
        availableNative: formatNativeAmount(updatedWei)
      };
    }

    return {
      ok: true,
      availableWei: updatedWei,
      availableNative: formatNativeAmount(updatedWei),
      requiredWei: minimumWei,
      requiredNative: formatNativeAmount(minimumWei),
      estimatorMode,
      toppedUp: true,
      topUpTxHash: topUp?.txHash || null,
      topUpAmountWei: topUp?.amountWei || topUpAmountWei.toString()
    };
  } catch (error) {
    return {
      ok: false,
      error: "gas sponsor top-up failed",
      details: error instanceof Error ? error.message : String(error),
      network,
      address: walletAddress,
      attemptedTopUpWei: topUpAmountWei.toString()
    };
  }
};

const withTimeout = async (promise, timeoutMs) => {
  const safeTimeoutMs = Math.max(1000, Number(timeoutMs || 0) || 300000);
  let timer;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`bridge_timeout_${safeTimeoutMs}ms`));
      }, safeTimeoutMs);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
};

const runConsolidationBridgeAsync = ({
  consolidationId,
  merchantId,
  accountId,
  sourceNetwork,
  destinationNetwork,
  destinationAddress,
  amount,
  asset,
  sourcePrivateKey,
  destinationPrivateKey
}) => {
  void (async () => {
    try {
      const bridgeResult = await withTimeout(
        consolidationBridgeService.bridge({
          sourceNetwork,
          destinationNetwork,
          destinationAddress,
          amount,
          asset,
          sourcePrivateKey,
          destinationPrivateKey
        }),
        config.consolidationBridgeTimeoutMs
      );

      updateConsolidationStatus(consolidationId, "confirmed", {
        txHash:
          String(
            bridgeResult.bridgeTxHash ||
              bridgeResult.destinationTxHash ||
              bridgeResult.sourceTxHash ||
              ""
          ).trim() || null,
        sourceTxHash: String(bridgeResult.sourceTxHash || "").trim() || null,
        bridgeTxHash: String(bridgeResult.bridgeTxHash || "").trim() || null,
        destinationTxHash: String(bridgeResult.destinationTxHash || "").trim() || null,
        failReason: null
      });
      recomputeBalances(merchantId, accountId);
      console.info("[merchant-os] consolidation bridge confirmed", {
        consolidationId,
        sourceNetwork,
        destinationNetwork,
        sourceTxHash: bridgeResult.sourceTxHash,
        bridgeTxHash: bridgeResult.bridgeTxHash,
        destinationTxHash: bridgeResult.destinationTxHash
      });
    } catch (error) {
      const failReason = sanitizeFailReason(error instanceof Error ? error.message : String(error));
      const details = error instanceof ConsolidationBridgeError ? error.details || {} : {};
      const sourceTxHash = String(details.sourceTxHash || details.failedStepTxHash || "").trim() || null;
      const bridgeTxHash = String(details.bridgeTxHash || details.failedStepTxHash || "").trim() || null;
      const destinationTxHash = String(details.destinationTxHash || "").trim() || null;
      const txHash = bridgeTxHash || destinationTxHash || sourceTxHash;
      updateConsolidationStatus(consolidationId, "failed", {
        failReason,
        txHash,
        sourceTxHash,
        bridgeTxHash,
        destinationTxHash
      });
      console.warn("[merchant-os] consolidation bridge failed", {
        consolidationId,
        sourceNetwork,
        destinationNetwork,
        failReason,
        sourceTxHash,
        bridgeTxHash,
        destinationTxHash,
        failedStepExplorerUrl: details.failedStepExplorerUrl || null
      });
    }
  })();
};

const server = createServer(async (req, res) => {
  const method = req.method || "GET";
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = requestUrl.pathname;

  try {
    if (method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      res.writeHead(302, {
        location: config.webUrl
      });
      res.end();
      return;
    }

    if (method === "GET" && pathname === "/health") {
      return sendJson(res, 200, {
        status: "ok",
        service: config.appName,
        timestamp: nowIso()
      });
    }

    if (method === "GET" && pathname === "/v1/demo/meta/credentials") {
      const merchants = getDemoMerchants().map((merchant) => ({
        merchantName: merchant.merchantName,
        email: merchant.email,
        password: merchant.password,
        merchantId: merchant.merchantId,
        accountId: merchant.accountId
      }));
      return sendJson(res, 200, { merchants });
    }

    if (method === "POST" && pathname === "/v1/demo/auth/login") {
      const body = await parseJsonBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");

      if (!email || !password) {
        return sendJson(res, 400, { error: "email and password are required" });
      }

      const user = authenticateUser(email, password);
      if (!user) {
        return sendJson(res, 401, { error: "Invalid credentials" });
      }

      const session = createSession({
        userId: user.id,
        merchantId: user.merchantId,
        accountId: user.accountId,
        role: user.role
      });

      return sendJson(res, 200, {
        token: session.token,
        expiresAt: session.expiresAt,
        user: {
          id: user.id,
          email: user.email,
          role: user.role
        },
        merchantId: user.merchantId,
        accountId: user.accountId
      });
    }

    if (method === "POST" && pathname === "/v1/demo/internal/events/settlements") {
      if (!validateIngestToken(req)) {
        return sendJson(res, 401, { error: "Unauthorized ingest token" });
      }

      const body = await parseJsonBody(req);
      const merchantId = String(body.merchantId || "").trim();
      const accountId = String(body.accountId || "").trim();
      const sourceNetwork = String(body.sourceNetwork || "").trim();
      const destinationNetwork = body.destinationNetwork ? String(body.destinationNetwork).trim() : null;
      const status = String(body.status || "").trim();
      const txHash = String(body.txHash || "").trim();
      const amount = String(body.amount || "").trim();
      const eventId = String(body.eventId || newId()).trim();
      const settlementId = String(body.settlementId || txHash || eventId).trim();
      const createdAt = String(body.createdAt || nowIso());
      const apiId = body.apiId ? String(body.apiId).trim() : null;
      const apiRoute = body.apiRoute ? String(body.apiRoute).trim() : null;
      const apiName = body.apiName ? String(body.apiName).trim() : null;
      const sourceTxHash = body.sourceTxHash ? String(body.sourceTxHash).trim() : txHash;
      const bridgeTxHash = body.bridgeTxHash ? String(body.bridgeTxHash).trim() : null;
      const destinationTxHash = body.destinationTxHash ? String(body.destinationTxHash).trim() : null;
      const blockNumber =
        body.blockNumber === null || body.blockNumber === undefined || body.blockNumber === ""
          ? null
          : Number.parseInt(String(body.blockNumber), 10);
      const logIndex =
        body.logIndex === null || body.logIndex === undefined || body.logIndex === ""
          ? null
          : Number.parseInt(String(body.logIndex), 10);
      const confirmations =
        body.confirmations === null || body.confirmations === undefined || body.confirmations === ""
          ? 0
          : Number.parseInt(String(body.confirmations), 10);

      const acceptedStatuses = new Set(["settled_source", "bridge_pending", "bridge_confirmed", "failed"]);
      if (!merchantId || !accountId || !sourceNetwork || !txHash || !amount) {
        return sendJson(res, 400, { error: "merchantId, accountId, sourceNetwork, amount, txHash are required" });
      }
      if (!acceptedStatuses.has(status)) {
        return sendJson(res, 400, { error: "invalid status" });
      }
      if (!normalizeUsdcAsset(body.asset)) {
        return sendJson(res, 400, { error: "USDC-only: unsupported asset" });
      }
      if (!/^[0-9]+$/.test(amount) || BigInt(amount) <= 0n) {
        return sendJson(res, 400, { error: "amount must be a positive base-unit string" });
      }
      if (blockNumber !== null && Number.isNaN(blockNumber)) {
        return sendJson(res, 400, { error: "blockNumber must be an integer" });
      }
      if (logIndex !== null && Number.isNaN(logIndex)) {
        return sendJson(res, 400, { error: "logIndex must be an integer" });
      }
      if (Number.isNaN(confirmations) || confirmations < 0) {
        return sendJson(res, 400, { error: "confirmations must be a non-negative integer" });
      }
      if (!ensureAccountExists(res, merchantId, accountId)) {
        return;
      }

      const duplicate = hasSettlementEvent(eventId);
      const duplicateLifecycle = hasSettlementLifecycleEvent(merchantId, accountId, settlementId, status);
      if (!duplicate && !duplicateLifecycle) {
        insertSettlementEvent({
          eventId,
          settlementId,
          merchantId,
          accountId,
          sourceNetwork,
          destinationNetwork,
          apiId,
          apiRoute,
          apiName,
          amount,
          status,
          txHash,
          sourceTxHash,
          bridgeTxHash,
          destinationTxHash,
          blockNumber,
          logIndex,
          confirmations,
          createdAt
        });
        recomputeBalances(merchantId, accountId);
      }

      return sendJson(res, 200, {
        success: true,
        duplicate: duplicate || duplicateLifecycle,
        eventId,
        settlementId
      });
    }

    if (method === "POST" && pathname === "/v1/demo/internal/requirements/resolve") {
      if (!validateInternalToken(req)) {
        return sendJson(res, 401, { error: "Unauthorized internal token" });
      }

      const body = await parseJsonBody(req);
      const merchantId = String(body.merchantId || "").trim();
      const accountId = String(body.accountId || "").trim();
      const apiProductId = body.apiProductId ? String(body.apiProductId).trim() : "";
      const routeMethod = normalizeHttpMethod(body.method || "GET");
      const routePath = normalizeRoutePath(body.path || "/api/premium");
      const settlementModeOverride =
        body.settlementModeOverride === undefined || body.settlementModeOverride === null
          ? null
          : String(body.settlementModeOverride).trim();

      if (!merchantId || !accountId) {
        return sendJson(res, 400, { error: "merchantId and accountId are required" });
      }
      if (!ensureAccountExists(res, merchantId, accountId)) {
        return;
      }

      const apiProduct = apiProductId
        ? getApiProductById(merchantId, accountId, apiProductId)
        : getApiProductByMethodPath(merchantId, accountId, routeMethod, routePath);

      if (!apiProduct || !apiProduct.enabled) {
        return sendJson(res, 404, { error: "API product not found or disabled" });
      }
      if (
        settlementModeOverride &&
        settlementModeOverride !== "same_chain" &&
        settlementModeOverride !== "cross_chain"
      ) {
        return sendJson(res, 400, {
          error: "settlementModeOverride must be same_chain or cross_chain"
        });
      }
      const effectiveSettlementMode = settlementModeOverride || apiProduct.settlementMode;

      const sourceWallet = getWalletByNetwork(merchantId, accountId, apiProduct.sourceNetwork);
      if (!sourceWallet) {
        return sendJson(res, 400, { error: "source network wallet not found for merchant account" });
      }

      const sourceAsset = String(apiProduct.sourceAsset || "").trim();
      if (!sourceAsset || !isUsdcAsset(sourceAsset)) {
        return sendJson(res, 400, { error: "source asset is invalid or not in USDC allowlist" });
      }
      const sourceDomain = resolveUsdcDomainProfile(apiProduct.sourceNetwork);

      let payTo = sourceWallet.address;
      let crossChain = null;
      if (effectiveSettlementMode === "cross_chain") {
        const destinationNetwork = apiProduct.destinationNetwork || getPolicy(merchantId, accountId)?.preferredNetwork;
        if (!destinationNetwork) {
          return sendJson(res, 400, { error: "destination network is required for cross-chain product" });
        }
        const destinationWallet = getWalletByNetwork(merchantId, accountId, destinationNetwork);
        if (!destinationWallet) {
          return sendJson(res, 400, { error: "destination wallet not found for cross-chain product" });
        }
        const destinationAsset = String(apiProduct.destinationAsset || sourceAsset).trim();
        if (!destinationAsset || !isUsdcAsset(destinationAsset)) {
          return sendJson(res, 400, { error: "destination asset is invalid or not in USDC allowlist" });
        }
        if (!config.facilitatorAddress || !/^0x[a-fA-F0-9]{40}$/.test(config.facilitatorAddress)) {
          return sendJson(res, 500, {
            error: "MERCHANT_OS_FACILITATOR_ADDRESS is required for cross-chain requirement resolution"
          });
        }
        payTo = config.facilitatorAddress;
        crossChain = {
          destinationNetwork,
          destinationAsset,
          destinationPayTo: destinationWallet.address
        };
      }

      const description = apiProduct.description || `${apiProduct.apiName} (${apiProduct.method} ${apiProduct.path})`;
      return sendJson(res, 200, {
        merchantId,
        accountId,
        settlementMode: effectiveSettlementMode,
        apiProduct,
        requirement: {
          scheme: "exact",
          network: apiProduct.sourceNetwork,
          price: {
            asset: sourceAsset,
            amount: apiProduct.amount,
            extra: {
              name: sourceDomain.name,
              version: sourceDomain.version,
              apiId: apiProduct.apiId,
              apiName: apiProduct.apiName,
              method: apiProduct.method,
              route: apiProduct.path,
              merchantId,
              accountId
            }
          },
          payTo,
          extra: {
            apiId: apiProduct.apiId,
            apiName: apiProduct.apiName,
            method: apiProduct.method,
            route: apiProduct.path,
            merchantId,
            accountId,
            description
          }
        },
        crossChain
      });
    }

    const apiProductsMatch = pathname.match(API_PRODUCTS_ROUTE);
    if (apiProductsMatch) {
      const merchantId = decodeURIComponent(apiProductsMatch[1]);
      const accountId = decodeURIComponent(apiProductsMatch[2]);
      const apiProductId = apiProductsMatch[3] ? decodeURIComponent(apiProductsMatch[3]) : null;

      const session = requireSession(req, res);
      if (!session) {
        return;
      }
      if (!requireTenant(res, session, merchantId, accountId)) {
        return;
      }
      if (!ensureAccountExists(res, merchantId, accountId)) {
        return;
      }

      if (method === "GET" && !apiProductId) {
        return sendJson(res, 200, {
          merchantId,
          accountId,
          items: listApiProducts(merchantId, accountId)
        });
      }

      if (method === "POST" && !apiProductId) {
        const body = await parseJsonBody(req);
        const apiId = String(body.apiId || "").trim();
        const apiName = String(body.apiName || "").trim();
        const description = body.description === undefined ? null : String(body.description || "").trim();
        const routeMethod = normalizeHttpMethod(body.method || "GET");
        const routePath = normalizeRoutePath(body.path);
        const sourceNetwork = String(body.sourceNetwork || "").trim();
        const sourceAsset = normalizeOptionalAddress(body.sourceAsset);
        const settlementMode = String(body.settlementMode || "cross_chain").trim();
        const destinationNetwork = body.destinationNetwork ? String(body.destinationNetwork).trim() : null;
        const destinationAsset = normalizeOptionalAddress(body.destinationAsset);
        const enabled = body.enabled === undefined ? true : Boolean(body.enabled);

        if (!apiId || !apiName || !routeMethod || !routePath || !sourceNetwork) {
          return sendJson(res, 400, {
            error: "apiId, apiName, method, path, and sourceNetwork are required"
          });
        }
        if (settlementMode !== "same_chain" && settlementMode !== "cross_chain") {
          return sendJson(res, 400, { error: "settlementMode must be same_chain or cross_chain" });
        }
        if (!getWalletByNetwork(merchantId, accountId, sourceNetwork)) {
          return sendJson(res, 400, { error: "source network wallet not found for this merchant account" });
        }
        if (settlementMode === "cross_chain") {
          if (!destinationNetwork) {
            return sendJson(res, 400, { error: "destinationNetwork is required for cross_chain products" });
          }
          if (!getWalletByNetwork(merchantId, accountId, destinationNetwork)) {
            return sendJson(res, 400, { error: "destination network wallet not found for this merchant account" });
          }
        }
        if (sourceAsset && !isUsdcAsset(sourceAsset)) {
          return sendJson(res, 400, { error: "USDC-only: sourceAsset not in allowlist" });
        }
        if (destinationAsset && !isUsdcAsset(destinationAsset)) {
          return sendJson(res, 400, { error: "USDC-only: destinationAsset not in allowlist" });
        }

        let amount;
        try {
          if (body.amountUsdc !== undefined && body.amountUsdc !== null && String(body.amountUsdc).trim() !== "") {
            amount = parsePositiveUsdcToBaseUnits(body.amountUsdc, "amountUsdc");
          } else {
            amount = parsePositiveBigInt(body.amount, "amount");
          }
        } catch (error) {
          return sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid amount" });
        }

        const created = createApiProduct({
          merchantId,
          accountId,
          apiId,
          apiName,
          description,
          method: routeMethod,
          path: routePath,
          sourceNetwork,
          sourceAsset: sourceAsset || undefined,
          amount: amount.toString(),
          settlementMode,
          destinationNetwork,
          destinationAsset,
          enabled
        });
        return sendJson(res, 200, created);
      }

      if (method === "PUT" && apiProductId) {
        const body = await parseJsonBody(req);
        const existing = getApiProductById(merchantId, accountId, apiProductId);
        if (!existing) {
          return sendJson(res, 404, { error: "API product not found" });
        }
        const patch = {};

        if (body.apiId !== undefined) {
          patch.apiId = String(body.apiId || "").trim();
          if (!patch.apiId) {
            return sendJson(res, 400, { error: "apiId cannot be empty" });
          }
        }
        if (body.apiName !== undefined) {
          patch.apiName = String(body.apiName || "").trim();
          if (!patch.apiName) {
            return sendJson(res, 400, { error: "apiName cannot be empty" });
          }
        }
        if (body.description !== undefined) {
          patch.description = body.description === null ? null : String(body.description || "").trim();
        }
        if (body.method !== undefined) {
          patch.method = normalizeHttpMethod(body.method);
          if (!patch.method) {
            return sendJson(res, 400, { error: "method cannot be empty" });
          }
        }
        if (body.path !== undefined) {
          patch.path = normalizeRoutePath(body.path);
          if (!patch.path) {
            return sendJson(res, 400, { error: "path cannot be empty" });
          }
        }
        if (body.sourceNetwork !== undefined) {
          patch.sourceNetwork = String(body.sourceNetwork || "").trim();
          if (!patch.sourceNetwork) {
            return sendJson(res, 400, { error: "sourceNetwork cannot be empty" });
          }
          if (!getWalletByNetwork(merchantId, accountId, patch.sourceNetwork)) {
            return sendJson(res, 400, { error: "source network wallet not found for this merchant account" });
          }
        }
        if (body.sourceAsset !== undefined) {
          patch.sourceAsset = normalizeOptionalAddress(body.sourceAsset);
          if (patch.sourceAsset && !isUsdcAsset(patch.sourceAsset)) {
            return sendJson(res, 400, { error: "USDC-only: sourceAsset not in allowlist" });
          }
        }
        if (body.amount !== undefined) {
          let amount;
          try {
            amount = parsePositiveBigInt(body.amount, "amount");
          } catch (error) {
            return sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid amount" });
          }
          patch.amount = amount.toString();
        }
        if (body.settlementMode !== undefined) {
          patch.settlementMode = String(body.settlementMode || "").trim();
          if (patch.settlementMode !== "same_chain" && patch.settlementMode !== "cross_chain") {
            return sendJson(res, 400, { error: "settlementMode must be same_chain or cross_chain" });
          }
        }
        if (body.destinationNetwork !== undefined) {
          patch.destinationNetwork = body.destinationNetwork ? String(body.destinationNetwork).trim() : null;
          if (patch.destinationNetwork && !getWalletByNetwork(merchantId, accountId, patch.destinationNetwork)) {
            return sendJson(res, 400, { error: "destination network wallet not found for this merchant account" });
          }
        }
        if (body.destinationAsset !== undefined) {
          patch.destinationAsset = normalizeOptionalAddress(body.destinationAsset);
          if (patch.destinationAsset && !isUsdcAsset(patch.destinationAsset)) {
            return sendJson(res, 400, { error: "USDC-only: destinationAsset not in allowlist" });
          }
        }
        if (body.enabled !== undefined) {
          patch.enabled = Boolean(body.enabled);
        }

        const resultingSettlementMode = patch.settlementMode || existing.settlementMode;
        const resultingDestinationNetwork =
          patch.destinationNetwork !== undefined ? patch.destinationNetwork : existing.destinationNetwork;
        if (resultingSettlementMode === "cross_chain") {
          if (!resultingDestinationNetwork) {
            return sendJson(res, 400, {
              error: "destinationNetwork is required when settlementMode is cross_chain"
            });
          }
          if (!getWalletByNetwork(merchantId, accountId, resultingDestinationNetwork)) {
            return sendJson(res, 400, { error: "destination network wallet not found for this merchant account" });
          }
        }

        const updated = updateApiProduct(merchantId, accountId, apiProductId, patch);
        return sendJson(res, 200, updated);
      }

      return sendJson(res, 405, { error: "Method not allowed" });
    }

    const accountMatch = pathname.match(ACCOUNT_ROUTE);
    if (accountMatch) {
      const merchantId = decodeURIComponent(accountMatch[1]);
      const accountId = decodeURIComponent(accountMatch[2]);
      const action = accountMatch[3];

      const session = requireSession(req, res);
      if (!session) {
        return;
      }
      if (!requireTenant(res, session, merchantId, accountId)) {
        return;
      }
      if (!ensureAccountExists(res, merchantId, accountId)) {
        return;
      }

      if (method === "GET" && action === "overview") {
        const overview = await buildOverviewResponse(merchantId, accountId);
        return sendJson(res, 200, overview);
      }

      if (method === "GET" && action === "settlements") {
        const limit = Number.parseInt(requestUrl.searchParams.get("limit") || "50", 10);
        return sendJson(res, 200, {
          merchantId,
          accountId,
          asOf: nowIso(),
          timeline: getTimeline(merchantId, accountId, Number.isNaN(limit) ? 50 : limit)
        });
      }

      if (method === "GET" && action === "api-revenue") {
        const limit = Number.parseInt(requestUrl.searchParams.get("limit") || "20", 10);
        const breakdown = getApiRevenueBreakdown(merchantId, accountId, Number.isNaN(limit) ? 20 : limit);
        return sendJson(res, 200, {
          merchantId,
          accountId,
          asOf: nowIso(),
          totals: breakdown.totals,
          apis: breakdown.items
        });
      }

      if (method === "PUT" && action === "policy") {
        const body = await parseJsonBody(req);
        const preferredNetwork = String(body.preferredNetwork || "").trim();
        const autoBridgeEnabled = Boolean(body.autoBridgeEnabled);
        const preferredAsset = body.preferredAsset ? String(body.preferredAsset) : "USDC";

        if (!preferredNetwork) {
          return sendJson(res, 400, { error: "preferredNetwork is required" });
        }
        if (!normalizeUsdcAsset(preferredAsset)) {
          return sendJson(res, 400, { error: "USDC-only: preferredAsset must be USDC" });
        }
        if (!getWalletByNetwork(merchantId, accountId, preferredNetwork)) {
          return sendJson(res, 400, { error: "preferredNetwork wallet not found for this merchant account" });
        }

        const policy = upsertPolicy(merchantId, accountId, {
          preferredNetwork,
          autoBridgeEnabled
        });
        return sendJson(res, 200, policy);
      }

      if (method === "POST" && action === "consolidations") {
        const body = await parseJsonBody(req);
        const sourceNetwork = String(body.sourceNetwork || "").trim();
        const destinationNetwork = String(body.destinationNetwork || "").trim();
        const normalizedAsset = normalizeUsdcAsset(body.asset || "USDC");

        if (!sourceNetwork || !destinationNetwork) {
          return sendJson(res, 400, { error: "sourceNetwork and destinationNetwork are required" });
        }
        if (sourceNetwork === destinationNetwork) {
          return sendJson(res, 400, { error: "sourceNetwork and destinationNetwork must differ" });
        }
        if (!normalizedAsset) {
          return sendJson(res, 400, { error: "USDC-only: unsupported asset" });
        }

        let amount;
        try {
          if (body.amountUsdc !== undefined && body.amountUsdc !== null && String(body.amountUsdc).trim() !== "") {
            amount = parsePositiveUsdcToBaseUnits(body.amountUsdc, "amountUsdc");
          } else {
            amount = parsePositiveBigInt(body.amount, "amount");
          }
        } catch (error) {
          return sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid amount" });
        }

        const sourceWallet = getWalletByNetwork(merchantId, accountId, sourceNetwork);
        if (!sourceWallet) {
          return sendJson(res, 400, { error: "source network wallet not found" });
        }
        const destinationWallet = getWalletByNetwork(merchantId, accountId, destinationNetwork);
        if (!destinationWallet) {
          return sendJson(res, 400, { error: "destination network wallet not found" });
        }

        const sourceBalance = getAvailableBalanceForNetwork(merchantId, accountId, sourceNetwork);
        if (sourceBalance < amount) {
          return sendJson(res, 400, {
            error: "insufficient source balance",
            available: sourceBalance.toString()
          });
        }

        let sourcePrivateKey = null;
        let destinationPrivateKey = null;

        if (config.realConsolidationBridgeEnabled) {
          const [sourceNativeBalance, destinationNativeBalance] = await Promise.all([
            fetchOnchainNativeBalance({
              network: sourceNetwork,
              address: sourceWallet.address,
              rpcByNetwork: config.rpcByNetwork,
              rpcUrlsByNetwork: config.rpcUrlsByNetwork,
              timeoutMs: config.onchainReadTimeoutMs
            }),
            fetchOnchainNativeBalance({
              network: destinationNetwork,
              address: destinationWallet.address,
              rpcByNetwork: config.rpcByNetwork,
              rpcUrlsByNetwork: config.rpcUrlsByNetwork,
              timeoutMs: config.onchainReadTimeoutMs
            })
          ]);

          if (!sourceNativeBalance) {
            return sendJson(res, 400, {
              error: "unable to verify source-network native gas balance",
              network: sourceNetwork,
              address: sourceWallet.address
            });
          }
          if (!destinationNativeBalance) {
            return sendJson(res, 400, {
              error: "unable to verify destination-network native gas balance",
              network: destinationNetwork,
              address: destinationWallet.address
            });
          }

          if (!consolidationBridgeService.supportsNetwork(sourceNetwork)) {
            return sendJson(res, 400, { error: `source network not supported by Bridge Kit: ${sourceNetwork}` });
          }
          if (!consolidationBridgeService.supportsNetwork(destinationNetwork)) {
            return sendJson(res, 400, {
              error: `destination network not supported by Bridge Kit: ${destinationNetwork}`
            });
          }

          const onchainSourceMap = await fetchOnchainUsdcBalancesByNetwork({
            wallets: [sourceWallet],
            rpcByNetwork: config.rpcByNetwork,
            rpcUrlsByNetwork: config.rpcUrlsByNetwork,
            usdcTokenByNetwork: config.usdcTokenByNetwork,
            timeoutMs: config.onchainReadTimeoutMs,
            totalBudgetMs: Math.max(config.onchainReadTimeoutMs, config.onchainReadTotalBudgetMs)
          });
          const onchainSource = onchainSourceMap.get(sourceNetwork);
          if (!onchainSource) {
            return sendJson(res, 400, {
              error: "unable to verify source-network onchain USDC balance",
              network: sourceNetwork,
              address: sourceWallet.address,
              hint: "increase MERCHANT_OS_ONCHAIN_TIMEOUT_MS and retry"
            });
          }
          const onchainSourceAmount = BigInt(onchainSource.amount);
          if (onchainSourceAmount < amount) {
            return sendJson(res, 400, {
              error: "insufficient source onchain USDC balance",
              network: sourceNetwork,
              address: sourceWallet.address,
              requested: amount.toString(),
              availableOnchain: onchainSourceAmount.toString()
            });
          }

          const [sourceGasRequirement, destinationGasRequirement] = await Promise.all([
            estimateRequiredBridgeGas({
              network: sourceNetwork,
              role: "source"
            }),
            estimateRequiredBridgeGas({
              network: destinationNetwork,
              role: "destination"
            })
          ]);

          const sourceGasCheck = await ensureNetworkGasForBridge({
            network: sourceNetwork,
            walletAddress: sourceWallet.address,
            currentWei: BigInt(sourceNativeBalance.amount),
            role: "source",
            gasRequirement: sourceGasRequirement
          });
          if (!sourceGasCheck.ok) {
            return sendJson(res, 400, sourceGasCheck);
          }

          const destinationGasCheck = await ensureNetworkGasForBridge({
            network: destinationNetwork,
            walletAddress: destinationWallet.address,
            currentWei: BigInt(destinationNativeBalance.amount),
            role: "destination",
            gasRequirement: destinationGasRequirement
          });
          if (!destinationGasCheck.ok) {
            return sendJson(res, 400, destinationGasCheck);
          }

          console.info("[merchant-os] consolidation preflight gas verified", {
            sourceNetwork,
            sourceWallet: sourceWallet.address,
            sourceAvailableWei: sourceGasCheck.availableWei?.toString?.() || null,
            sourceRequiredWei: sourceGasCheck.requiredWei?.toString?.() || null,
            sourceToppedUp: Boolean(sourceGasCheck.toppedUp),
            sourceTopUpTxHash: sourceGasCheck.topUpTxHash || null,
            destinationNetwork,
            destinationWallet: destinationWallet.address,
            destinationAvailableWei: destinationGasCheck.availableWei?.toString?.() || null,
            destinationRequiredWei: destinationGasCheck.requiredWei?.toString?.() || null,
            destinationToppedUp: Boolean(destinationGasCheck.toppedUp),
            destinationTopUpTxHash: destinationGasCheck.topUpTxHash || null
          });

          if (sourceGasCheck.toppedUp || destinationGasCheck.toppedUp) {
            console.info("[merchant-os] gas sponsor top-up completed", {
              sourceNetwork,
              sourceWallet: sourceWallet.address,
              sourceEstimatorMode: sourceGasRequirement.mode,
              sourceRequiredWei: sourceGasRequirement.requiredWei.toString(),
              sourceTopUpTxHash: sourceGasCheck.topUpTxHash || null,
              destinationNetwork,
              destinationWallet: destinationWallet.address,
              destinationEstimatorMode: destinationGasRequirement.mode,
              destinationRequiredWei: destinationGasRequirement.requiredWei.toString(),
              destinationTopUpTxHash: destinationGasCheck.topUpTxHash || null
            });
          }

          sourcePrivateKey = getCustodyPrivateKeyByReference(
            merchantId,
            accountId,
            sourceWallet.keyReference
          );
          if (!sourcePrivateKey) {
            return sendJson(res, 500, {
              error: `Missing custody key for source wallet reference: ${sourceWallet.keyReference}`
            });
          }

          destinationPrivateKey =
            getCustodyPrivateKeyByReference(merchantId, accountId, destinationWallet.keyReference) ||
            sourcePrivateKey;
          if (!destinationPrivateKey) {
            return sendJson(res, 500, {
              error: `Missing custody key for destination wallet reference: ${destinationWallet.keyReference}`
            });
          }
        }

        const consolidationId = createConsolidation({
          merchantId,
          accountId,
          sourceNetwork,
          destinationNetwork,
          amount: amount.toString()
        });

        updateConsolidationStatus(consolidationId, "submitted");

        if (config.realConsolidationBridgeEnabled) {

          runConsolidationBridgeAsync({
            consolidationId,
            merchantId,
            accountId,
            sourceNetwork,
            destinationNetwork,
            destinationAddress: destinationWallet.address,
            amount: amount.toString(),
            asset: normalizedAsset,
            sourcePrivateKey,
            destinationPrivateKey
          });
        } else {
          updateConsolidationStatus(consolidationId, "confirmed");
          recomputeBalances(merchantId, accountId);
        }

        return sendJson(res, 202, getConsolidation(consolidationId));
      }

      if (method === "POST" && action === "payouts") {
        const body = await parseJsonBody(req);
        const network = String(body.network || "").trim();
        const destinationAddress = String(body.destinationAddress || "").trim();
        const normalizedAsset = normalizeUsdcAsset(body.asset || "USDC");

        if (!network || !destinationAddress) {
          return sendJson(res, 400, { error: "network and destinationAddress are required" });
        }
        if (!/^0x[a-fA-F0-9]{40}$/.test(destinationAddress)) {
          return sendJson(res, 400, { error: "destinationAddress must be a valid EVM address" });
        }
        if (!normalizedAsset) {
          return sendJson(res, 400, { error: "USDC-only: unsupported asset" });
        }

        let amount;
        try {
          amount = parsePositiveBigInt(body.amount, "amount");
        } catch (error) {
          return sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid amount" });
        }

        if (!getWalletByNetwork(merchantId, accountId, network)) {
          return sendJson(res, 400, { error: "network wallet not found" });
        }

        const sourceBalance = getAvailableBalanceForNetwork(merchantId, accountId, network);
        if (sourceBalance < amount) {
          return sendJson(res, 400, {
            error: "insufficient balance",
            available: sourceBalance.toString()
          });
        }

        const payoutId = createPayoutRequest({
          merchantId,
          accountId,
          network,
          amount: amount.toString(),
          destinationAddress
        });

        updatePayoutStatus(payoutId, "completed");
        recomputeBalances(merchantId, accountId);

        return sendJson(res, 200, getPayoutRequest(payoutId));
      }

      return sendJson(res, 405, { error: "Method not allowed" });
    }

    // Serve static assets from public (e.g. /RailBridge-Logo.png, /chain-logos/*)
    if (method === "GET" && !pathname.startsWith("/v1/") && pathname !== "/" && pathname !== "/index.html" && pathname !== "/health") {
      const base = resolve(publicDir);
      const resolved = resolve(base, pathname.replace(/^\//, "").replace(/\.\./g, ""));
      if ((resolved === base || resolved.startsWith(base + sep)) && existsSync(resolved)) {
        if (statSync(resolved).isFile()) {
          const ext = pathname.slice(pathname.lastIndexOf("."));
          const contentType = MIME_TYPES[ext] || "application/octet-stream";
          res.writeHead(200, { "content-type": contentType });
          createReadStream(resolved).pipe(res);
          return;
        }
      }
    }

    // Redirect browser routes to the Next.js frontend app.
    if (method === "GET" && !pathname.startsWith("/v1/")) {
      const destination = `${config.webUrl}${pathname}${requestUrl.search || ""}`;
      res.writeHead(302, { location: destination });
      res.end();
      return;
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    return sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Internal server error"
    });
  }
});

initializeDatabase();

server.listen(config.port, () => {
  console.log(`Merchant OS demo listening on http://localhost:${config.port}`);
  console.log(`Health: http://localhost:${config.port}/health`);
  console.log(`Frontend redirect: ${config.webUrl}`);
  console.log("Demo logins:");
  getDemoMerchants().forEach((merchant) => {
    console.log(
      `- ${merchant.merchantName}: email=${merchant.email} password=${merchant.password} merchantId=${merchant.merchantId} accountId=${merchant.accountId}`
    );
  });
});
