import { createServer } from "node:http";
import { URL } from "node:url";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, sep } from "node:path";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createHash, timingSafeEqual as cryptoTimingSafeEqual } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";
import {
  fetchOnchainGasPrice,
  fetchOnchainNativeBalance,
  fetchOnchainUsdcBalancesByNetwork
} from "./onchain.js";
import { ConsolidationBridgeError, ConsolidationBridgeService } from "./consolidationBridgeService.js";
import { GasSponsorService } from "./gasSponsorService.js";
import { transferUsdcOnchain, UsdcTransferError } from "./usdcTransferService.js";
import { privacyVaultService } from "./privacyVaultService.js";
import {
  acquireTenantMutationDbLock,
  authenticatePlatformUser,
  countActiveApiKeys,
  countActiveApiKeysByRole,
  createApiKey,
  createApiProduct,
  createConsolidation,
  deletePayoutAddressBookEntry,
  deleteRevokedApiKeyById,
  createWebhookEndpoint,
  deleteApiProduct,
  deleteWebhookEndpoint,
  findApiKeyByToken,
  findPayoutAddressBookEntryByNetworkAddress,
  getApiProductByApiId,
  getChainCatalogByNetwork,
  getChainCatalogRuntimeMaps,
  createPayoutRequest,
  createSession,
  getApiProductById,
  getApiProductByMethodPath,
  getApiKeyById,
  getAvailableBalanceForNetwork,
  getBalances,
  getConsolidation,
  getCustodyPrivateKeyByReference,
  getPayoutAddressBookEntryById,
  getWebhookEndpointById,
  hasSettlementLifecycleEvent,
  getPayoutRequest,
  getPendingPrivateIntakeBalances,
  getPolicy,
  getSession,
  queryTimeline,
  resolvePaymentRequirementContextForSettlement,
  getTimeline,
  getWalletByNetwork,
  getWallets,
  hasSettlementEvent,
  initializeDatabase,
  insertSettlementEvent,
  listPayoutAddressBookEntries,
  listWorkspaceLoginIdentities,
  listApiProducts,
  listChainCatalog,
  onboardMerchantAccount,
  recomputeBalances,
  releaseTenantMutationDbLock,
  revokeApiKeyById,
  setChainCatalogStatus,
  touchApiKeyUsed,
  touchPayoutAddressBookEntryUsedByNetworkAddress,
  upsertPolicy,
  upsertPrivateAccount,
  upsertPayoutAddressBookEntry,
  updateApiKeyMetadata,
  updateApiProduct,
  updateConsolidationStatus,
  updatePayoutAddressBookEntry,
  updateTenantProfile,
  updateWebhookEndpoint,
  updatePayoutStatus
} from "./db.js";
import { ChainCatalogService } from "./chainCatalogService.js";
import {
  publishTenantWebhookEvent,
  sendWebhookTestEvent
} from "./webhookService.js";
import {
  newId,
  nowIso,
  parsePositiveBigInt,
  parsePositiveUsdcToBaseUnits,
  toDecimalUsdcString
} from "./utils.js";
import {
  buildOnboardingChecklist,
  buildTenantSettingsPayload
} from "./services/onboardingService.js";
import { resolvePaymentRequirementsForTenant } from "./services/requirementsResolverService.js";
import {
  SOURCE_NETWORK_ANY,
  isSourceNetworkAny,
  normalizeSourceNetworkPreference,
  normalizeUsdcAsset
} from "./services/usdcRoutingService.js";

const MERCHANT_ROUTE = /^\/v1\/merchants\/([^/]+)\/(balances|settlements|products|consolidations|payouts|settings)$/;
const MERCHANT_PRODUCTS_ITEM_ROUTE = /^\/v1\/merchants\/([^/]+)\/products\/([^/]+)$/;
const MERCHANT_CONSOLIDATIONS_ESTIMATE_ROUTE = /^\/v1\/merchants\/([^/]+)\/consolidations\/estimate$/;
const MERCHANT_CONSOLIDATION_ITEM_ROUTE = /^\/v1\/merchants\/([^/]+)\/consolidations\/([^/]+)$/;
const MERCHANT_PAYOUT_ADDRESS_BOOK_ROUTE = /^\/v1\/merchants\/([^/]+)\/payout-addresses$/;
const MERCHANT_PAYOUT_ADDRESS_BOOK_ITEM_ROUTE = /^\/v1\/merchants\/([^/]+)\/payout-addresses\/([^/]+)$/;
const ONBOARDING_WEBHOOK_ITEM_ROUTE = /^\/v1\/onboarding\/webhooks\/(?!test$)([^/]+)$/;
const MAX_JSON_BODY_BYTES = 1_000_000;
const TENANT_MUTATION_LOCKS = new Set();
const IS_PRODUCTION_MODE = String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS_PER_WINDOW = 8;
const API_KEY_TOUCH_DEBOUNCE_MS = 60 * 1000;
const loginAttemptBuckets = new Map();
const apiKeyLastTouchedAtMs = new Map();

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

const normalizeHttpMethod = (method) => String(method || "").trim().toUpperCase();
const normalizeTreasuryMode = (value) =>
  String(value || "").trim().toLowerCase() === "private" ? "private" : "public";

const normalizeRoutePath = (path) => {
  const value = String(path || "").trim();
  if (!value) {
    return "";
  }
  return value.startsWith("/") ? value : `/${value}`;
};

const normalizeEvmAddress = (value) => {
  const text = String(value || "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(text) ? text : null;
};

const defaultCustodyWalletAddress = normalizeEvmAddress(config.custodyAddress);

const deterministicWalletAddress = (merchantId, network) => {
  const seed = `${merchantId}:${network}`;
  const digest = createHash("sha256").update(seed).digest("hex");
  return `0x${digest.slice(0, 40)}`;
};

const emailDomain = (email) => {
  const parts = String(email || "").trim().toLowerCase().split("@");
  return parts.length === 2 ? parts[1] : "";
};

const isOnboardingAllowlisted = (email) => {
  if (config.onboardingAutoApprove) {
    return true;
  }
  if (!config.onboardingAllowlistDomains.size) {
    return true;
  }
  const domain = emailDomain(email);
  return domain ? config.onboardingAllowlistDomains.has(domain) : false;
};

const resolveRuntimeChainMaps = () => {
  const runtime = getChainCatalogRuntimeMaps();
  return {
    rpcByNetwork: runtime.rpcByNetwork,
    rpcUrlsByNetwork: runtime.rpcUrlsByNetwork,
    usdcTokenByNetwork: runtime.usdcTokenByNetwork
  };
};

const parseBaseUnitsSafe = (value) => {
  try {
    return BigInt(String(value || "0"));
  } catch {
    return 0n;
  }
};

const mergeOnchainAndProjectedUsdcAmount = ({ onchainAmount, projectedAmount }) => {
  if (onchainAmount === null && projectedAmount === null) {
    return {
      amount: 0n,
      source: "none"
    };
  }
  if (onchainAmount !== null && projectedAmount !== null) {
    if (onchainAmount === 0n && projectedAmount > 0n) {
      return {
        amount: projectedAmount,
        source: "projected"
      };
    }
    return {
      amount: onchainAmount,
      source: "onchain"
    };
  }
  if (onchainAmount !== null) {
    return {
      amount: onchainAmount,
      source: "onchain"
    };
  }
  return {
    amount: projectedAmount,
    source: "projected"
  };
};

const buildAvailableAndPendingUsdcAmount = ({ onchainAmount, projectedAmount }) => {
  const normalizedProjectedAmount = projectedAmount === null ? 0n : projectedAmount;
  const hasOnchainAmount = onchainAmount !== null;
  const availableAmount = hasOnchainAmount ? onchainAmount : 0n;
  const pendingAmount =
    normalizedProjectedAmount > availableAmount ? normalizedProjectedAmount - availableAmount : 0n;

  let source = "none";
  if (hasOnchainAmount) {
    source = "onchain";
  } else if (normalizedProjectedAmount > 0n) {
    source = "projected";
  }

  return {
    availableAmount,
    projectedAmount: normalizedProjectedAmount,
    pendingAmount,
    source,
    readStatus: hasOnchainAmount ? "ok" : "onchain_unavailable"
  };
};

const getEffectiveNetworkUsdcBalance = async ({
  merchantId,
  accountId,
  network,
  wallet = null,
  strictOnchain = false
}) => {
  const projectedAmount = getAvailableBalanceForNetwork(merchantId, accountId, network);
  const targetWallet = wallet || getWalletByNetwork(merchantId, accountId, network);
  if (!targetWallet) {
    if (strictOnchain) {
      return {
        amount: 0n,
        source: projectedAmount > 0n ? "onchain_unavailable" : "none",
        projectedAmount,
        onchainAmount: null
      };
    }
    return {
      amount: projectedAmount,
      source: projectedAmount > 0n ? "projected" : "none",
      projectedAmount,
      onchainAmount: null
    };
  }

  const runtimeMaps = resolveRuntimeChainMaps();
  const onchainByNetwork = await fetchOnchainUsdcBalancesByNetwork({
    wallets: [targetWallet],
    rpcByNetwork: runtimeMaps.rpcByNetwork,
    rpcUrlsByNetwork: runtimeMaps.rpcUrlsByNetwork,
    usdcTokenByNetwork: runtimeMaps.usdcTokenByNetwork,
    timeoutMs: config.onchainReadTimeoutMs,
    totalBudgetMs: Math.max(config.onchainReadTimeoutMs, config.onchainReadTotalBudgetMs)
  });
  const onchainRow = onchainByNetwork.get(network);
  const onchainAmount = onchainRow ? parseBaseUnitsSafe(onchainRow.amount) : null;
  const merged = mergeOnchainAndProjectedUsdcAmount({
    onchainAmount,
    projectedAmount
  });
  if (strictOnchain) {
    return {
      amount: onchainAmount === null ? 0n : onchainAmount,
      source: onchainAmount === null ? "onchain_unavailable" : "onchain",
      projectedAmount,
      onchainAmount
    };
  }
  return {
    amount: merged.amount,
    source: merged.source,
    projectedAmount,
    onchainAmount
  };
};

const parseJsonBody = async (req) => {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += Buffer.byteLength(chunk);
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      const error = new Error("Request body too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    const error = new Error("Invalid JSON body");
    error.statusCode = 400;
    throw error;
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

const timingSafeEqual = (left, right) => {
  if (typeof left !== "string" || typeof right !== "string") {
    return false;
  }
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return cryptoTimingSafeEqual(a, b);
};

const getRequestIp = (req) => {
  const forwardedFor = String(req.headers["x-forwarded-for"] || "").trim();
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  const realIp = String(req.headers["x-real-ip"] || "").trim();
  if (realIp) {
    return realIp;
  }
  return String(req.socket?.remoteAddress || "unknown");
};

const buildLoginRateLimitKey = (req, email) => `${getRequestIp(req)}::${String(email || "").trim().toLowerCase()}`;

const checkLoginRateLimit = (key) => {
  const now = Date.now();
  const bucket = loginAttemptBuckets.get(key);
  if (!bucket) {
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (now - bucket.windowStartedAtMs >= LOGIN_RATE_LIMIT_WINDOW_MS) {
    loginAttemptBuckets.delete(key);
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (bucket.count < MAX_LOGIN_ATTEMPTS_PER_WINDOW) {
    return { allowed: true, retryAfterSeconds: 0 };
  }
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((LOGIN_RATE_LIMIT_WINDOW_MS - (now - bucket.windowStartedAtMs)) / 1000)
  );
  return { allowed: false, retryAfterSeconds };
};

const recordFailedLoginAttempt = (key) => {
  const now = Date.now();
  const current = loginAttemptBuckets.get(key);
  if (!current || now - current.windowStartedAtMs >= LOGIN_RATE_LIMIT_WINDOW_MS) {
    loginAttemptBuckets.set(key, { count: 1, windowStartedAtMs: now });
    return;
  }
  loginAttemptBuckets.set(key, {
    count: current.count + 1,
    windowStartedAtMs: current.windowStartedAtMs
  });
};

const clearLoginAttempts = (key) => {
  loginAttemptBuckets.delete(key);
};

const maybeTouchApiKeyUsed = (keyId) => {
  const now = Date.now();
  const lastTouchedAt = apiKeyLastTouchedAtMs.get(keyId) || 0;
  if (now - lastTouchedAt < API_KEY_TOUCH_DEBOUNCE_MS) {
    return;
  }
  apiKeyLastTouchedAtMs.set(keyId, now);
  touchApiKeyUsed(keyId);
};

const isStrongPassword = (value) => {
  const password = String(value || "");
  return (
    password.length >= 12 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
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

const requireApiKey = (req, res) => {
  const headerValue = req.headers["x-railbridge-api-key"];
  const token = typeof headerValue === "string" ? headerValue.trim() : "";
  if (token) {
    const key = findApiKeyByToken(token);
    if (!key) {
      sendJson(res, 401, { error: "Invalid API key" });
      return null;
    }
    maybeTouchApiKeyUsed(key.id);
    return key;
  }

  const sessionToken = getBearerToken(req);
  const session = getSession(sessionToken);
  if (session) {
    return {
      id: `session:${session.userId}`,
      merchantId: session.merchantId,
      accountId: session.accountId,
      role: session.role,
      status: "active"
    };
  }

  sendJson(res, 401, { error: "Missing x-railbridge-api-key or valid Bearer session token" });
  return null;
};

const requireRole = (res, key, allowedRoles = []) => {
  if (allowedRoles.includes(key.role)) {
    return true;
  }
  sendJson(res, 403, {
    error: `Forbidden: requires one of [${allowedRoles.join(", ")}]`
  });
  return false;
};

const isAllowedWebhookUrl = (value) => {
  try {
    const parsed = new URL(String(value || "").trim());
    if (parsed.protocol === "https:") {
      return true;
    }
    if (parsed.protocol !== "http:") {
      return false;
    }
    if (IS_PRODUCTION_MODE) {
      return false;
    }
    const host = String(parsed.hostname || "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
};

const acquireTenantMutationLock = (lockKey) => {
  if (TENANT_MUTATION_LOCKS.has(lockKey)) {
    return null;
  }
  const dbLock = acquireTenantMutationDbLock(lockKey, 120000);
  if (!dbLock) {
    return null;
  }
  TENANT_MUTATION_LOCKS.add(lockKey);
  return { lockKey, dbLock };
};

const releaseTenantMutationLock = (lockHandle) => {
  if (!lockHandle) {
    return;
  }
  TENANT_MUTATION_LOCKS.delete(lockHandle.lockKey);
  releaseTenantMutationDbLock(lockHandle.dbLock);
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

const BALANCES_ONCHAIN_MODES = new Set(["skip", "priority", "all"]);
const TIMELINE_FILTER_TO_ITEM_TYPES = {
  treasury: ["consolidation"],
  payment: ["settlement"],
  payouts: ["payout"]
};

const parseBalancesOnchainMode = (searchParams) => {
  const raw = String(searchParams?.get("onchain") || "priority")
    .trim()
    .toLowerCase();
  return BALANCES_ONCHAIN_MODES.has(raw) ? raw : "priority";
};

const parseIsoDateBoundary = (rawValue, mode) => {
  const value = String(rawValue || "").trim();
  if (!value) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return mode === "start" ? `${value}T00:00:00.000Z` : `${value}T23:59:59.999Z`;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString();
};

const parseTimelineQuery = (searchParams) => {
  const pageRaw = Number.parseInt(String(searchParams?.get("page") || "1"), 10);
  const pageSizeRaw = Number.parseInt(String(searchParams?.get("pageSize") || "20"), 10);
  const page = Number.isNaN(pageRaw) ? 1 : Math.max(1, pageRaw);
  const pageSize = Number.isNaN(pageSizeRaw) ? 20 : Math.max(1, Math.min(pageSizeRaw, 100));

  const typeRaw = String(searchParams?.get("type") || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const itemTypeSet = new Set();
  typeRaw.forEach((type) => {
    const mapped = TIMELINE_FILTER_TO_ITEM_TYPES[type];
    if (mapped) {
      mapped.forEach((itemType) => itemTypeSet.add(itemType));
    }
  });

  const createdFrom = parseIsoDateBoundary(searchParams?.get("dateFrom"), "start");
  const createdTo = parseIsoDateBoundary(searchParams?.get("dateTo"), "end");
  return {
    page,
    pageSize,
    itemTypes: [...itemTypeSet],
    createdFrom,
    createdTo
  };
};

const buildOverviewResponse = async (merchantId, accountId, options = {}) => {
  const onchainMode = BALANCES_ONCHAIN_MODES.has(options.onchainMode)
    ? options.onchainMode
    : "priority";
  const policy = getPolicy(merchantId, accountId);
  if (policy?.treasuryMode === "private") {
    const privateHomeNetwork = String(policy.privateHomeNetwork || "").trim() || String(policy.preferredNetwork || "").trim();
    const projectedPublicBalances = getBalances(merchantId, accountId);
    const projectedPublicByNetwork = new Map(
      projectedPublicBalances.map((row) => [row.network, BigInt(String(row.amount || "0"))])
    );
    const liveBalance = privateHomeNetwork
      ? await privacyVaultService.getPrivateBalance({
          merchantId,
          accountId,
          network: privateHomeNetwork
        })
      : {
          provider: "unlink",
          environment: null,
          network: null,
          amount: "0",
          freshness: "degraded",
          lastProviderSyncAt: null,
          readStatus: "private_home_network_missing"
        };
    const pendingRows = getPendingPrivateIntakeBalances(merchantId, accountId);
    const pendingByNetwork = new Map(
      pendingRows.map((row) => [row.network, BigInt(String(row.totalAmount || "0"))])
    );
    const networks = new Set([
      ...projectedPublicByNetwork.keys(),
      ...pendingByNetwork.keys(),
      ...(privateHomeNetwork ? [privateHomeNetwork] : [])
    ]);
    const balances = [...networks]
      .filter(Boolean)
      .map((network) => {
        const privateAvailable =
          network === privateHomeNetwork ? BigInt(String(liveBalance.amount || "0")) : 0n;
        const projectedPublicAmount = projectedPublicByNetwork.get(network) || 0n;
        const pendingSweepAmount = pendingByNetwork.get(network) || 0n;
        const publicFallbackAmount =
          projectedPublicAmount > pendingSweepAmount ? projectedPublicAmount - pendingSweepAmount : 0n;
        const pendingWithdrawalAmount = 0n;
        const availableAmount = privateAvailable + publicFallbackAmount;
        const projectedAmount = availableAmount + pendingSweepAmount;
        return {
          network,
          asset: "USDC",
          amount: availableAmount.toString(),
          decimals: 6,
          usdValue: toDecimalUsdcString(availableAmount),
          projectedAmount: projectedAmount.toString(),
          projectedUsdValue: toDecimalUsdcString(projectedAmount),
          pendingAmount: pendingSweepAmount.toString(),
          pendingUsdValue: toDecimalUsdcString(pendingSweepAmount),
          privateAvailableAmount: privateAvailable.toString(),
          privateAvailableUsdValue: toDecimalUsdcString(privateAvailable),
          publicFallbackAmount: publicFallbackAmount.toString(),
          publicFallbackUsdValue: toDecimalUsdcString(publicFallbackAmount),
          pendingSweepAmount: pendingSweepAmount.toString(),
          pendingSweepUsdValue: toDecimalUsdcString(pendingSweepAmount),
          pendingWithdrawalAmount: pendingWithdrawalAmount.toString(),
          pendingWithdrawalUsdValue: toDecimalUsdcString(pendingWithdrawalAmount),
          onchainAmount: null,
          source:
            privateAvailable > 0n && publicFallbackAmount > 0n
              ? "hybrid_private_public_fallback"
              : privateAvailable > 0n
                ? "private"
                : publicFallbackAmount > 0n
                  ? "public_fallback"
                  : "private_pending",
          readStatus:
            network === privateHomeNetwork
              ? liveBalance.readStatus
              : publicFallbackAmount > 0n
                ? "public_fallback_balance"
                : "ledger_pending_private_intake",
          balanceFreshness:
            network === privateHomeNetwork ? liveBalance.freshness : "cached",
          lastProviderSyncAt:
            network === privateHomeNetwork ? liveBalance.lastProviderSyncAt : null,
          updatedAt:
            network === privateHomeNetwork && liveBalance.lastProviderSyncAt
              ? liveBalance.lastProviderSyncAt
              : nowIso()
        };
      })
      .sort((left, right) => left.network.localeCompare(right.network));

    const availableBaseUnits = balances.reduce((sum, row) => sum + BigInt(row.amount), 0n);
    const projectedBaseUnits = balances.reduce((sum, row) => sum + BigInt(row.projectedAmount), 0n);
    const pendingSweepBaseUnits = balances.reduce((sum, row) => sum + BigInt(row.pendingSweepAmount), 0n);
    const pendingWithdrawalBaseUnits = balances.reduce(
      (sum, row) => sum + BigInt(row.pendingWithdrawalAmount),
      0n
    );

    return {
      merchantId,
      accountId,
      asOf: nowIso(),
      onchainMode: "private",
      unifiedUsd: toDecimalUsdcString(availableBaseUnits),
      availableUsd: toDecimalUsdcString(availableBaseUnits),
      projectedUsd: toDecimalUsdcString(projectedBaseUnits),
      pendingBridgeUsd: toDecimalUsdcString(pendingSweepBaseUnits),
      pendingSweepUsd: toDecimalUsdcString(pendingSweepBaseUnits),
      pendingWithdrawalUsd: toDecimalUsdcString(pendingWithdrawalBaseUnits),
      balanceFreshness: liveBalance.freshness,
      lastProviderSyncAt: liveBalance.lastProviderSyncAt,
      policy,
      balances
    };
  }

  const runtimeMaps = resolveRuntimeChainMaps();
  const projectedBalances = getBalances(merchantId, accountId);
  const wallets = getWallets(merchantId, accountId);
  const walletByNetwork = new Map(wallets.map((wallet) => [wallet.network, wallet]));
  const projectedByNetwork = new Map(
    projectedBalances.map((row) => [
      row.network,
      {
        amount: row.amount,
        updatedAt: row.updatedAt
      }
    ])
  );
  const walletsForOnchain =
    onchainMode === "skip"
      ? []
      : onchainMode === "priority"
        ? wallets.filter((wallet) => {
            const projected = projectedByNetwork.get(wallet.network);
            try {
              return projected && parseBaseUnitsSafe(projected.amount) > 0n;
            } catch {
              return false;
            }
          })
        : wallets;
  const onchainBudgetMs =
    onchainMode === "all"
      ? config.onchainReadTotalBudgetMs
      : Math.min(config.onchainReadTotalBudgetMs, 2500);
  const onchainByNetwork =
    walletsForOnchain.length > 0
      ? await fetchOnchainUsdcBalancesByNetwork({
          wallets: walletsForOnchain,
          rpcByNetwork: runtimeMaps.rpcByNetwork,
          rpcUrlsByNetwork: runtimeMaps.rpcUrlsByNetwork,
          usdcTokenByNetwork: runtimeMaps.usdcTokenByNetwork,
          timeoutMs: config.onchainReadTimeoutMs,
          totalBudgetMs: onchainBudgetMs
        })
      : new Map();

  const networks = new Set([
    ...walletByNetwork.keys(),
    ...projectedByNetwork.keys(),
    ...onchainByNetwork.keys()
  ]);

  const balances = [...networks]
    .map((network) => {
      const projected = projectedByNetwork.get(network);
      const onchain = onchainByNetwork.get(network);
      const onchainAmount = onchain ? parseBaseUnitsSafe(onchain.amount) : null;
      const projectedAmount = projected ? parseBaseUnitsSafe(projected.amount) : null;
      const available = buildAvailableAndPendingUsdcAmount({
        onchainAmount,
        projectedAmount
      });

      const updatedAt = onchain?.asOf || projected?.updatedAt || nowIso();
      return {
        network,
        asset: "USDC",
        amount: available.availableAmount.toString(),
        decimals: 6,
        usdValue: toDecimalUsdcString(available.availableAmount),
        projectedAmount: available.projectedAmount.toString(),
        projectedUsdValue: toDecimalUsdcString(available.projectedAmount),
        pendingAmount: available.pendingAmount.toString(),
        pendingUsdValue: toDecimalUsdcString(available.pendingAmount),
        onchainAmount: onchainAmount === null ? null : onchainAmount.toString(),
        source: available.source,
        readStatus: available.readStatus,
        updatedAt
      };
    })
    .sort((left, right) => left.network.localeCompare(right.network));

  const availableBaseUnits = balances.reduce((sum, row) => sum + BigInt(row.amount), 0n);
  const projectedBaseUnits = balances.reduce((sum, row) => sum + BigInt(row.projectedAmount), 0n);
  const pendingBridgeBaseUnits = balances.reduce((sum, row) => sum + BigInt(row.pendingAmount), 0n);

  return {
    merchantId,
    accountId,
    asOf: nowIso(),
    onchainMode,
    unifiedUsd: toDecimalUsdcString(availableBaseUnits),
    availableUsd: toDecimalUsdcString(availableBaseUnits),
    projectedUsd: toDecimalUsdcString(projectedBaseUnits),
    pendingBridgeUsd: toDecimalUsdcString(pendingBridgeBaseUnits),
    policy,
    custody: {
      mode: "custodial",
      wallets: wallets.map((wallet) => ({
        network: wallet.network,
        asset: wallet.asset,
        address: wallet.address
      }))
    },
    balances
  };
};

const validateIngestToken = (req) => {
  const headerToken = req.headers["x-merchant-os-ingest-token"];
  if (typeof headerToken === "string" && timingSafeEqual(headerToken, config.ingestToken)) {
    return true;
  }
  return false;
};

const validateInternalToken = (req) => {
  const headerToken = req.headers["x-merchant-os-internal-token"];
  if (typeof headerToken === "string" && timingSafeEqual(headerToken, config.internalToken)) {
    return true;
  }
  const ingestToken = req.headers["x-merchant-os-ingest-token"];
  if (typeof ingestToken === "string" && timingSafeEqual(ingestToken, config.internalToken)) {
    return true;
  }
  const bearer = getBearerToken(req);
  return Boolean(bearer && timingSafeEqual(bearer, config.internalToken));
};

const consolidationBridgeService = new ConsolidationBridgeService();
const gasSponsorService = new GasSponsorService({
  privateKey: config.gasSponsorPrivateKey,
  rpcByNetwork: config.rpcByNetwork,
  rpcUrlsByNetwork: config.rpcUrlsByNetwork
});
const chainCatalogService = new ChainCatalogService();

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
if (config.realPayoutsEnabled) {
  console.info("[merchant-os] Real payout execution enabled.");
} else {
  console.warn("[merchant-os] Real payout execution disabled. Payouts will be ledger-simulated.");
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

const resolveBridgeGasBufferBps = () => {
  const rawBufferBps = Number(config.gasEstimatorBufferBps || 18000);
  return Math.max(10000, Number.isFinite(rawBufferBps) ? rawBufferBps : 18000);
};

const buildBridgeKitGasRequirement = ({ network, role, estimateEntry }) => {
  const bufferBps = resolveBridgeGasBufferBps();
  const estimatedFeeWei = BigInt(estimateEntry?.estimatedFeeWei || "0");
  let requiredWei = (estimatedFeeWei * BigInt(bufferBps)) / 10000n;
  if (requiredWei < MIN_BRIDGE_NATIVE_BALANCE_WEI) {
    requiredWei = MIN_BRIDGE_NATIVE_BALANCE_WEI;
  }

  return {
    mode: "bridge_kit_estimate",
    network,
    role,
    requiredWei,
    gasPriceWei: null,
    gasUnits: null,
    bufferBps,
    estimatedFeeWei,
    stepNames: Array.isArray(estimateEntry?.stepNames) ? estimateEntry.stepNames : [],
    tokenSymbol: estimateEntry?.tokenSymbol || null
  };
};

const parseNonNegativeUsdcToBaseUnits = (value) => {
  const text = String(value ?? "").trim();
  if (!text) {
    return 0n;
  }
  if (!/^[0-9]+(?:\.[0-9]{1,6})?$/.test(text)) {
    return 0n;
  }
  const [wholeRaw, fracRaw = ""] = text.split(".");
  return BigInt(wholeRaw) * 1_000_000n + BigInt(fracRaw.padEnd(6, "0"));
};

const buildBridgeGasStatus = ({ network, role, currentWei, gasRequirement }) => {
  const minimumWei = gasRequirement?.requiredWei || MIN_BRIDGE_NATIVE_BALANCE_WEI;
  const availableWei = BigInt(currentWei || "0");
  const shortfallWei = availableWei < minimumWei ? minimumWei - availableWei : 0n;
  const estimatorEstimatedFeeWei = gasRequirement?.estimatedFeeWei || null;
  const estimatorStepNames = Array.isArray(gasRequirement?.stepNames) ? gasRequirement.stepNames : [];

  return {
    network,
    role,
    sufficient: availableWei >= minimumWei,
    availableWei: availableWei.toString(),
    availableNative: formatNativeAmount(availableWei),
    requiredWei: minimumWei.toString(),
    requiredNative: formatNativeAmount(minimumWei),
    shortfallWei: shortfallWei.toString(),
    shortfallNative: formatNativeAmount(shortfallWei),
    estimatorMode: gasRequirement?.mode || "static_fallback",
    estimatorEstimatedFeeWei: estimatorEstimatedFeeWei ? estimatorEstimatedFeeWei.toString() : null,
    estimatorEstimatedFeeNative: estimatorEstimatedFeeWei ? formatNativeAmount(estimatorEstimatedFeeWei) : null,
    estimatorStepNames,
    tokenSymbol: gasRequirement?.tokenSymbol || null
  };
};

const buildConsolidationEstimateRecommendation = ({
  amountBaseUnits,
  protocolFeeBaseUnits,
  sourceGasStatus,
  destinationGasStatus,
  executionMode
}) => {
  if (executionMode !== "real") {
    return {
      level: "info",
      code: "simulation_mode",
      summary: "Estimate preview is limited in simulation mode.",
      details: "Enable the real Circle Bridge Kit flow to see gas sufficiency and cost estimates."
    };
  }

  if (!sourceGasStatus?.sufficient || !destinationGasStatus?.sufficient) {
    return {
      level: "caution",
      code: "gas_topup_likely",
      summary: "One or more bridge wallets will likely need native gas top-up.",
      details:
        "RailBridge can attempt sponsor top-up on submit, but the bridge cannot start until both source and destination wallets are above the estimated native gas threshold."
    };
  }

  if (amountBaseUnits < 1_000_000n) {
    return {
      level: "warning",
      code: "tiny_transfer",
      summary: "This transfer amount is very small for a cross-chain move.",
      details:
        "The bridge is technically allowed, but moving less than 1 USDC is usually not worthwhile once gas overhead and operational complexity are considered."
    };
  }

  if (protocolFeeBaseUnits > 0n && protocolFeeBaseUnits * 5n >= amountBaseUnits) {
    return {
      level: "caution",
      code: "fees_high_relative_to_amount",
      summary: "Bridge fees are high relative to the transfer amount.",
      details:
        "This transfer will work, but the amount is small compared with the current protocol fee estimate. A larger transfer size may be more efficient."
    };
  }

  return {
    level: "good",
    code: "healthy_transfer",
    summary: "This bridge amount looks reasonable for the current route.",
    details:
      "Circle Bridge Kit cost estimation succeeded and both wallets appear to have enough native gas for the transfer."
  };
};

const buildConsolidationEstimatePreview = async ({
  merchantId,
  accountId,
  sourceNetwork,
  destinationNetwork,
  normalizedAsset,
  amount
}) => {
  const sourceWallet = getWalletByNetwork(merchantId, accountId, sourceNetwork);
  if (!sourceWallet) {
    return { ok: false, statusCode: 400, payload: { error: "source network wallet not found" } };
  }
  const destinationWallet = getWalletByNetwork(merchantId, accountId, destinationNetwork);
  if (!destinationWallet) {
    return { ok: false, statusCode: 400, payload: { error: "destination network wallet not found" } };
  }

  const sourceBalanceInfo = await getEffectiveNetworkUsdcBalance({
    merchantId,
    accountId,
    network: sourceNetwork,
    wallet: sourceWallet,
    strictOnchain: config.realConsolidationBridgeEnabled
  });
  if (sourceBalanceInfo.amount < amount) {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        error: "insufficient source balance",
        available: sourceBalanceInfo.amount.toString(),
        availableSource: sourceBalanceInfo.source,
        availableProjected: sourceBalanceInfo.projectedAmount.toString(),
        availableOnchain: sourceBalanceInfo.onchainAmount === null ? null : sourceBalanceInfo.onchainAmount.toString()
      }
    };
  }

  const basePayload = {
    sourceNetwork,
    destinationNetwork,
    asset: normalizedAsset,
    amount: amount.toString(),
    amountUsdc: toDecimalUsdcString(amount),
    executionMode: config.realConsolidationBridgeEnabled ? "real" : "simulation",
    note: "Estimate only. No funds move and no gas top-up is triggered during this preview.",
    sourceBalance: {
      availableBaseUnits: sourceBalanceInfo.amount.toString(),
      availableUsdc: toDecimalUsdcString(sourceBalanceInfo.amount.toString()),
      source: sourceBalanceInfo.source,
      availableProjectedBaseUnits: sourceBalanceInfo.projectedAmount.toString(),
      availableOnchainBaseUnits:
        sourceBalanceInfo.onchainAmount === null ? null : sourceBalanceInfo.onchainAmount.toString()
    }
  };

  if (!config.realConsolidationBridgeEnabled) {
    return {
      ok: true,
      statusCode: 200,
      payload: {
        ...basePayload,
        gasFees: [],
        protocolFees: [],
        recommendation: buildConsolidationEstimateRecommendation({
          amountBaseUnits: amount,
          protocolFeeBaseUnits: 0n,
          sourceGasStatus: null,
          destinationGasStatus: null,
          executionMode: "simulation"
        })
      }
    };
  }

  const sourcePrivateKey = getCustodyPrivateKeyByReference(
    merchantId,
    accountId,
    sourceWallet.keyReference
  );
  if (!sourcePrivateKey) {
    return {
      ok: false,
      statusCode: 500,
      payload: { error: `Missing custody key for source wallet reference: ${sourceWallet.keyReference}` }
    };
  }

  const destinationPrivateKey =
    getCustodyPrivateKeyByReference(merchantId, accountId, destinationWallet.keyReference) ||
    sourcePrivateKey;
  if (!destinationPrivateKey) {
    return {
      ok: false,
      statusCode: 500,
      payload: { error: `Missing custody key for destination wallet reference: ${destinationWallet.keyReference}` }
    };
  }

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
    return {
      ok: false,
      statusCode: 400,
      payload: {
        error: "unable to verify source-network native gas balance",
        network: sourceNetwork,
        address: sourceWallet.address
      }
    };
  }
  if (!destinationNativeBalance) {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        error: "unable to verify destination-network native gas balance",
        network: destinationNetwork,
        address: destinationWallet.address
      }
    };
  }

  if (!consolidationBridgeService.supportsNetwork(sourceNetwork)) {
    return {
      ok: false,
      statusCode: 400,
      payload: { error: `source network not supported by Bridge Kit: ${sourceNetwork}` }
    };
  }
  if (!consolidationBridgeService.supportsNetwork(destinationNetwork)) {
    return {
      ok: false,
      statusCode: 400,
      payload: { error: `destination network not supported by Bridge Kit: ${destinationNetwork}` }
    };
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
    return {
      ok: false,
      statusCode: 400,
      payload: {
        error: "unable to verify source-network onchain USDC balance",
        network: sourceNetwork,
        address: sourceWallet.address,
        hint: "increase MERCHANT_OS_ONCHAIN_TIMEOUT_MS and retry"
      }
    };
  }
  const onchainSourceAmount = BigInt(onchainSource.amount);
  if (onchainSourceAmount < amount) {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        error: "insufficient source onchain USDC balance",
        network: sourceNetwork,
        address: sourceWallet.address,
        requested: amount.toString(),
        availableOnchain: onchainSourceAmount.toString()
      }
    };
  }

  const [fallbackSourceGasRequirement, fallbackDestinationGasRequirement] = await Promise.all([
    estimateRequiredBridgeGas({
      network: sourceNetwork,
      role: "source"
    }),
    estimateRequiredBridgeGas({
      network: destinationNetwork,
      role: "destination"
    })
  ]);

  let sourceGasRequirement = fallbackSourceGasRequirement;
  let destinationGasRequirement = fallbackDestinationGasRequirement;
  let protocolFees = [];
  let bridgeKitEstimateStatus = "fallback";
  let bridgeKitEstimateError = null;

  try {
    const bridgeKitEstimate = await consolidationBridgeService.estimateGasRequirements({
      sourceNetwork,
      destinationNetwork,
      destinationAddress: destinationWallet.address,
      amount: amount.toString(),
      asset: normalizedAsset,
      sourcePrivateKey,
      destinationPrivateKey
    });

    if (bridgeKitEstimate?.sourceNetwork?.estimatedFeeWei !== undefined) {
      sourceGasRequirement = buildBridgeKitGasRequirement({
        network: sourceNetwork,
        role: "source",
        estimateEntry: bridgeKitEstimate.sourceNetwork
      });
    }
    if (bridgeKitEstimate?.destinationNetwork?.estimatedFeeWei !== undefined) {
      destinationGasRequirement = buildBridgeKitGasRequirement({
        network: destinationNetwork,
        role: "destination",
        estimateEntry: bridgeKitEstimate.destinationNetwork
      });
    }

    protocolFees = (Array.isArray(bridgeKitEstimate?.estimate?.fees) ? bridgeKitEstimate.estimate.fees : []).map(
      (item) => ({
        type: item?.type || "provider",
        token: item?.token || "USDC",
        amount: item?.amount ?? null
      })
    );
    bridgeKitEstimateStatus = "ok";
  } catch (error) {
    bridgeKitEstimateError = error instanceof Error ? error.message : String(error);
  }

  const sourceGasStatus = buildBridgeGasStatus({
    network: sourceNetwork,
    role: "source",
    currentWei: BigInt(sourceNativeBalance.amount),
    gasRequirement: sourceGasRequirement
  });
  const destinationGasStatus = buildBridgeGasStatus({
    network: destinationNetwork,
    role: "destination",
    currentWei: BigInt(destinationNativeBalance.amount),
    gasRequirement: destinationGasRequirement
  });

  const protocolFeeBaseUnits = protocolFees.reduce((total, item) => {
    if (String(item.token || "").toUpperCase() !== "USDC") {
      return total;
    }
    return total + parseNonNegativeUsdcToBaseUnits(item.amount);
  }, 0n);

  return {
    ok: true,
    statusCode: 200,
    payload: {
      ...basePayload,
      bridgeKitEstimateStatus,
      bridgeKitEstimateError,
      gasFees: [sourceGasStatus, destinationGasStatus],
      protocolFees,
      recommendation: buildConsolidationEstimateRecommendation({
        amountBaseUnits: amount,
        protocolFeeBaseUnits,
        sourceGasStatus,
        destinationGasStatus,
        executionMode: "real"
      }),
      sponsorPolicy: {
        autoTopupEnabled: config.gasSponsorAutoTopupEnabled,
        minBridgeNativeBalanceWei: config.minBridgeNativeBalanceWei.toString(),
        minBridgeNativeBalance: formatNativeAmount(config.minBridgeNativeBalanceWei),
        gasSponsorTopupWei: config.gasSponsorTopupWei.toString(),
        gasSponsorTopupNative: formatNativeAmount(config.gasSponsorTopupWei)
      }
    }
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
  const estimatorEstimatedFeeWei = gasRequirement?.estimatedFeeWei || null;
  const estimatorStepNames = Array.isArray(gasRequirement?.stepNames) ? gasRequirement.stepNames : null;

  if (currentWei >= minimumWei) {
    return {
      ok: true,
      availableWei: currentWei,
      availableNative: formatNativeAmount(currentWei),
      requiredWei: minimumWei,
      requiredNative: formatNativeAmount(minimumWei),
      estimatorMode,
      estimatorEstimatedFeeWei: estimatorEstimatedFeeWei ? estimatorEstimatedFeeWei.toString() : null,
      estimatorStepNames,
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
      estimatorEstimatedFeeWei: estimatorEstimatedFeeWei ? estimatorEstimatedFeeWei.toString() : null,
      estimatorStepNames,
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
        availableNative: formatNativeAmount(updatedWei),
        estimatorEstimatedFeeWei: estimatorEstimatedFeeWei ? estimatorEstimatedFeeWei.toString() : null,
        estimatorStepNames
      };
    }

    return {
      ok: true,
      availableWei: updatedWei,
      availableNative: formatNativeAmount(updatedWei),
      requiredWei: minimumWei,
      requiredNative: formatNativeAmount(minimumWei),
      estimatorMode,
      estimatorEstimatedFeeWei: estimatorEstimatedFeeWei ? estimatorEstimatedFeeWei.toString() : null,
      estimatorStepNames,
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
      const consolidation = getConsolidation(consolidationId);
      await publishTenantWebhookEvent({
        merchantId,
        accountId,
        eventType: "consolidation.confirmed",
        eventId: `evt_${consolidationId}_confirmed`,
        data: consolidation
      });
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
      const consolidation = getConsolidation(consolidationId);
      await publishTenantWebhookEvent({
        merchantId,
        accountId,
        eventType: "consolidation.failed",
        eventId: `evt_${consolidationId}_failed`,
        data: consolidation
      });
      const sourceRpcUrls = consolidationBridgeService.rpcUrlsForNetwork(sourceNetwork);
      const destinationRpcUrls = consolidationBridgeService.rpcUrlsForNetwork(destinationNetwork);
      console.warn("[merchant-os] consolidation bridge failed", {
        consolidationId,
        sourceNetwork,
        destinationNetwork,
        failReason,
        sourceTxHash,
        bridgeTxHash,
        destinationTxHash,
        failedStepExplorerUrl: details.failedStepExplorerUrl || null,
        sourceRpcUrlCount: sourceRpcUrls.length,
        destinationRpcUrlCount: destinationRpcUrls.length
      });
    }
  })();
};

const executePayout = async ({
  merchantId,
  accountId,
  network,
  destinationAddress,
  amount
}) => {
  const sourceWallet = getWalletByNetwork(merchantId, accountId, network);
  if (!sourceWallet) {
    return {
      ok: false,
      statusCode: 400,
      payload: { error: "network wallet not found" }
    };
  }
  const sourceBalanceInfo = await getEffectiveNetworkUsdcBalance({
    merchantId,
    accountId,
    network,
    wallet: sourceWallet,
    strictOnchain: config.realPayoutsEnabled
  });
  if (sourceBalanceInfo.amount < amount) {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        error: "insufficient balance",
        available: sourceBalanceInfo.amount.toString(),
        availableSource: sourceBalanceInfo.source,
        availableProjected: sourceBalanceInfo.projectedAmount.toString(),
        availableOnchain: sourceBalanceInfo.onchainAmount === null ? null : sourceBalanceInfo.onchainAmount.toString()
      }
    };
  }
  const chain = getChainCatalogByNetwork(network);
  if (chain?.status === "paused") {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        error: "network is paused by RailBridge operations",
        network
      }
    };
  }

  const payoutId = createPayoutRequest({
    merchantId,
    accountId,
    network,
    amount: amount.toString(),
    destinationAddress
  });
  updatePayoutStatus(payoutId, "submitted");

  if (!config.realPayoutsEnabled) {
    updatePayoutStatus(payoutId, "completed");
    recomputeBalances(merchantId, accountId);
    const payout = getPayoutRequest(payoutId);
    await publishTenantWebhookEvent({
      merchantId,
      accountId,
      eventType: "payout.completed",
      eventId: `evt_${payoutId}_completed`,
      data: payout
    });
    return {
      ok: true,
      statusCode: 201,
      payout
    };
  }

  const sourcePrivateKey = getCustodyPrivateKeyByReference(
    merchantId,
    accountId,
    sourceWallet.keyReference
  );
  if (!sourcePrivateKey) {
    updatePayoutStatus(payoutId, "failed", {
      failReason: "missing custody signer for wallet reference"
    });
    const payout = getPayoutRequest(payoutId);
    await publishTenantWebhookEvent({
      merchantId,
      accountId,
      eventType: "payout.failed",
      eventId: `evt_${payoutId}_failed`,
      data: payout
    });
    return {
      ok: false,
      statusCode: 500,
      payload: {
        error: "Missing custody signer for payout source wallet",
        payout
      }
    };
  }

  const signerAddress = privateKeyToAccount(sourcePrivateKey).address;
  const normalizedWalletAddress = normalizeEvmAddress(sourceWallet.address);
  if (!normalizedWalletAddress || normalizedWalletAddress.toLowerCase() !== signerAddress.toLowerCase()) {
    updatePayoutStatus(payoutId, "failed", {
      failReason: "custody signer does not match source wallet address"
    });
    const payout = getPayoutRequest(payoutId);
    await publishTenantWebhookEvent({
      merchantId,
      accountId,
      eventType: "payout.failed",
      eventId: `evt_${payoutId}_failed`,
      data: payout
    });
    return {
      ok: false,
      statusCode: 400,
      payload: {
        error: "custody signer does not match source wallet address",
        signerAddress,
        walletAddress: sourceWallet.address,
        payout
      }
    };
  }

  const sourceNativeBalance = await fetchOnchainNativeBalance({
    network,
    address: sourceWallet.address,
    rpcByNetwork: config.rpcByNetwork,
    rpcUrlsByNetwork: config.rpcUrlsByNetwork,
    timeoutMs: config.onchainReadTimeoutMs
  });
  if (!sourceNativeBalance) {
    updatePayoutStatus(payoutId, "failed", {
      failReason: "unable to verify source-network native gas balance"
    });
    const payout = getPayoutRequest(payoutId);
    await publishTenantWebhookEvent({
      merchantId,
      accountId,
      eventType: "payout.failed",
      eventId: `evt_${payoutId}_failed`,
      data: payout
    });
    return {
      ok: false,
      statusCode: 400,
      payload: {
        error: "unable to verify source-network native gas balance",
        network,
        address: sourceWallet.address,
        payout
      }
    };
  }

  const gasRequirement = await estimateRequiredBridgeGas({
    network,
    role: "source"
  });
  const sourceGasCheck = await ensureNetworkGasForBridge({
    network,
    walletAddress: sourceWallet.address,
    currentWei: BigInt(sourceNativeBalance.amount),
    role: "source",
    gasRequirement
  });
  if (!sourceGasCheck.ok) {
    updatePayoutStatus(payoutId, "failed", {
      failReason: sanitizeFailReason(sourceGasCheck.error || "gas preflight failed")
    });
    const payout = getPayoutRequest(payoutId);
    await publishTenantWebhookEvent({
      merchantId,
      accountId,
      eventType: "payout.failed",
      eventId: `evt_${payoutId}_failed`,
      data: payout
    });
    return {
      ok: false,
      statusCode: 400,
      payload: {
        ...sourceGasCheck,
        payout
      }
    };
  }

  try {
    const transfer = await transferUsdcOnchain({
      network,
      destinationAddress,
      amountBaseUnits: amount.toString(),
      sourcePrivateKey,
      rpcByNetwork: config.rpcByNetwork,
      rpcUrlsByNetwork: config.rpcUrlsByNetwork,
      usdcTokenByNetwork: config.usdcTokenByNetwork,
      txTimeoutMs: config.payoutTxTimeoutMs,
      rpcTimeoutMs: config.consolidationBridgeRpcTimeoutMs,
      rpcRetryCount: config.consolidationBridgeRpcRetryCount
    });
    updatePayoutStatus(payoutId, "completed", {
      txHash: transfer.txHash,
      failReason: null
    });
    recomputeBalances(merchantId, accountId);
    const payout = getPayoutRequest(payoutId);
    await publishTenantWebhookEvent({
      merchantId,
      accountId,
      eventType: "payout.completed",
      eventId: `evt_${payoutId}_completed`,
      data: payout
    });
    return {
      ok: true,
      statusCode: 201,
      payout
    };
  } catch (error) {
    const details = error instanceof UsdcTransferError ? error.details || {} : {};
    updatePayoutStatus(payoutId, "failed", {
      failReason: sanitizeFailReason(error instanceof Error ? error.message : String(error)),
      txHash: String(details.txHash || "").trim() || null
    });
    const payout = getPayoutRequest(payoutId);
    await publishTenantWebhookEvent({
      merchantId,
      accountId,
      eventType: "payout.failed",
      eventId: `evt_${payoutId}_failed`,
      data: payout
    });
    return {
      ok: false,
      statusCode: 502,
      payload: {
        error: "payout execution failed",
        details: error instanceof Error ? error.message : String(error),
        payout
      }
    };
  }
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

    if (method === "GET" && pathname === "/v1/chains") {
      const key = requireApiKey(req, res);
      if (!key) {
        return;
      }
      return sendJson(res, 200, {
        items: listChainCatalog()
      });
    }

    if (method === "POST" && pathname.startsWith("/v1/admin/chains/") && pathname.endsWith("/status")) {
      if (!config.adminToken || getBearerToken(req) !== config.adminToken) {
        return sendJson(res, 401, { error: "Unauthorized admin token" });
      }
      const parts = pathname.split("/");
      const network = decodeURIComponent(parts[4] || "");
      const body = await parseJsonBody(req);
      const status = String(body.status || "").trim().toLowerCase();
      if (!network) {
        return sendJson(res, 400, { error: "network is required" });
      }
      try {
        setChainCatalogStatus(network, status);
        chainCatalogService.refreshRuntimeMaps();
      } catch (error) {
        return sendJson(res, 400, {
          error: error instanceof Error ? error.message : "Invalid status"
        });
      }
      return sendJson(res, 200, {
        success: true,
        network,
        status
      });
    }

    if (method === "POST" && pathname === "/v1/auth/login") {
      const body = await parseJsonBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");

      if (!email || !password) {
        return sendJson(res, 400, { error: "email and password are required" });
      }

      const loginRateLimitKey = buildLoginRateLimitKey(req, email);
      const limitState = checkLoginRateLimit(loginRateLimitKey);
      if (!limitState.allowed) {
        return sendJson(res, 429, {
          error: "Too many login attempts. Try again later.",
          retryAfterSeconds: limitState.retryAfterSeconds
        });
      }

      const user = authenticatePlatformUser(email, password);
      if (!user) {
        recordFailedLoginAttempt(loginRateLimitKey);
        return sendJson(res, 401, { error: "Invalid credentials" });
      }
      clearLoginAttempts(loginRateLimitKey);

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
        merchantName: user.merchantName,
        accountName: user.accountName,
        merchantId: user.merchantId,
        accountId: user.accountId,
        checklist: buildOnboardingChecklist(user.merchantId, user.accountId)
      });
    }

    if (method === "POST" && pathname === "/v1/onboarding/start") {
      const body = await parseJsonBody(req);
      const merchantName = String(body.merchantName || "").trim();
      const adminEmail = String(body.adminEmail || "").trim().toLowerCase();
      const adminPassword = String(body.adminPassword || "");
      const complianceProfile =
        body.complianceProfile && typeof body.complianceProfile === "object"
          ? body.complianceProfile
          : null;

      if (!merchantName || !adminEmail || !adminPassword) {
        return sendJson(res, 400, {
          error: "merchantName, adminEmail, and adminPassword are required"
        });
      }
      if (!isStrongPassword(adminPassword)) {
        return sendJson(res, 400, {
          error:
            "adminPassword must be at least 12 characters and include uppercase, lowercase, number, and symbol"
        });
      }

      if (!isOnboardingAllowlisted(adminEmail)) {
        return sendJson(res, 403, {
          error: "domain_not_allowlisted",
          message:
            "This workspace is in guided allowlist mode. Contact RailBridge to approve your domain."
        });
      }

      const catalogChains = listChainCatalog().filter((chain) => chain.status !== "paused");
      const fallbackChains = catalogChains.length
        ? catalogChains
        : [{ network: config.demoSourceNetwork }];

      const chainProfiles = fallbackChains
        .map((chain) => ({
          network: chain.network,
          signerReference: `mpc:${merchantName.toLowerCase().replace(/[^a-z0-9]+/g, "_")}:${chain.network}`,
          address: defaultCustodyWalletAddress || deterministicWalletAddress(merchantName, chain.network)
        }));

      const onboarding = onboardMerchantAccount({
        merchantName,
        adminEmail,
        adminPassword,
        complianceProfile,
        chainProfiles
      });

      const session = createSession({
        userId: onboarding.adminUserId,
        merchantId: onboarding.merchantId,
        accountId: onboarding.accountId,
        role: "admin"
      });

      const apiKey = createApiKey({
        merchantId: onboarding.merchantId,
        accountId: onboarding.accountId,
        name: "Default API Key",
        role: "admin",
        createdByUserId: onboarding.adminUserId
      });

      return sendJson(res, 201, {
        token: session.token,
        user: {
          id: onboarding.adminUserId,
          email: adminEmail,
          role: "admin"
        },
        merchantName,
        accountName: `${merchantName} Treasury`,
        merchantId: onboarding.merchantId,
        accountId: onboarding.accountId,
        apiKey: apiKey.token,
        checklist: buildOnboardingChecklist(onboarding.merchantId, onboarding.accountId)
      });
    }

    if (method === "GET" && pathname === "/v1/onboarding/checklist") {
      const session = requireSession(req, res);
      if (!session) {
        return;
      }
      return sendJson(res, 200, buildOnboardingChecklist(session.merchantId, session.accountId));
    }

    if (method === "GET" && pathname === "/v1/onboarding/settings") {
      const session = requireSession(req, res);
      if (!session) {
        return;
      }
      return sendJson(res, 200, buildTenantSettingsPayload(session.merchantId, session.accountId));
    }

    if (method === "PATCH" && pathname === "/v1/onboarding/policy") {
      const session = requireSession(req, res);
      if (!session) {
        return;
      }
      if (session.role !== "admin" && session.role !== "finance") {
        return sendJson(res, 403, { error: "Forbidden: only admin/finance can update treasury policy" });
      }

      const body = await parseJsonBody(req);
      const currentPolicy = getPolicy(session.merchantId, session.accountId);
      const nextPreferredNetwork =
        body.preferredNetwork !== undefined
          ? String(body.preferredNetwork || "").trim()
          : String(currentPolicy?.preferredNetwork || "").trim();
      if (!nextPreferredNetwork) {
        return sendJson(res, 400, { error: "preferredNetwork is required" });
      }

      if (nextPreferredNetwork !== "same_chain") {
        const targetChain = getChainCatalogByNetwork(nextPreferredNetwork);
        if (!targetChain) {
          return sendJson(res, 400, { error: "preferredNetwork is not in the active chain catalog" });
        }
        if (targetChain.status === "paused") {
          return sendJson(res, 400, { error: "preferredNetwork is paused by operations" });
        }
      }

      const nextAutoBridgeEnabled =
        body.autoBridgeEnabled !== undefined
          ? Boolean(body.autoBridgeEnabled)
          : Boolean(currentPolicy?.autoBridgeEnabled ?? true);
      const nextTreasuryMode =
        body.treasuryMode !== undefined
          ? normalizeTreasuryMode(body.treasuryMode)
          : normalizeTreasuryMode(currentPolicy?.treasuryMode);
      const nextPrivateHomeNetwork =
        body.privateHomeNetwork !== undefined
          ? String(body.privateHomeNetwork || "").trim()
          : String(currentPolicy?.privateHomeNetwork || "").trim();

      if (nextTreasuryMode === "private" && !nextPrivateHomeNetwork) {
        return sendJson(res, 400, { error: "privateHomeNetwork is required when treasuryMode=private" });
      }

      if (nextTreasuryMode === "private" && nextPrivateHomeNetwork) {
        const privateHomeChain = getChainCatalogByNetwork(nextPrivateHomeNetwork);
        if (!privateHomeChain) {
          return sendJson(res, 400, { error: "privateHomeNetwork is not in the active chain catalog" });
        }
        if (privateHomeChain.status === "paused") {
          return sendJson(res, 400, { error: "privateHomeNetwork is paused by operations" });
        }
      }

      const nextPrivacyEnabledAt =
        nextTreasuryMode === "private"
          ? String(currentPolicy?.privacyEnabledAt || nowIso())
          : null;

      const updatedPolicy = upsertPolicy(session.merchantId, session.accountId, {
        preferredNetwork: nextPreferredNetwork,
        autoBridgeEnabled: nextAutoBridgeEnabled,
        treasuryMode: nextTreasuryMode,
        privateHomeNetwork: nextTreasuryMode === "private" ? nextPrivateHomeNetwork : null,
        privacyEnabledAt: nextPrivacyEnabledAt
      });

      return sendJson(res, 200, {
        success: true,
        policy: updatedPolicy
      });
    }

    if (method === "PATCH" && pathname === "/v1/onboarding/profile") {
      const session = requireSession(req, res);
      if (!session) {
        return;
      }
      if (session.role !== "admin" && session.role !== "finance") {
        return sendJson(res, 403, { error: "Forbidden: only admin/finance can update profile" });
      }

      const body = await parseJsonBody(req);
      const hasMerchantName = body.merchantName !== undefined;
      const hasAccountName = body.accountName !== undefined;
      const hasUserEmail = body.userEmail !== undefined;
      if (!hasMerchantName && !hasAccountName && !hasUserEmail) {
        return sendJson(res, 400, {
          error: "Provide at least one editable field: merchantName, accountName, or userEmail"
        });
      }

      const merchantName = hasMerchantName ? String(body.merchantName || "").trim() : undefined;
      const accountName = hasAccountName ? String(body.accountName || "").trim() : undefined;
      const userEmail = hasUserEmail ? String(body.userEmail || "").trim().toLowerCase() : undefined;

      if (merchantName !== undefined && merchantName.length < 2) {
        return sendJson(res, 400, { error: "merchantName must be at least 2 characters" });
      }
      if (accountName !== undefined && accountName.length < 2) {
        return sendJson(res, 400, { error: "accountName must be at least 2 characters" });
      }
      if (userEmail !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
        return sendJson(res, 400, { error: "userEmail must be a valid email address" });
      }

      try {
        const profile = updateTenantProfile({
          merchantId: session.merchantId,
          accountId: session.accountId,
          actingUserId: session.userId,
          merchantName,
          accountName,
          userEmail
        });
        if (!profile) {
          return sendJson(res, 404, { error: "Merchant account not found" });
        }
        return sendJson(res, 200, {
          merchantId: profile.merchantId,
          accountId: profile.accountId,
          merchantName: profile.merchantName,
          accountName: profile.accountName,
          user: profile.userEmail
            ? {
                email: profile.userEmail,
                role: profile.userRole || session.role
              }
            : null
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/UNIQUE constraint failed: merchant_users\.email/i.test(message)) {
          return sendJson(res, 409, { error: "Email is already used by another user" });
        }
        return sendJson(res, 500, { error: "Failed to update profile" });
      }
    }

    if (method === "POST" && pathname === "/v1/onboarding/webhooks") {
      const session = requireSession(req, res);
      if (!session) {
        return;
      }
      if (session.role !== "admin" && session.role !== "finance") {
        return sendJson(res, 403, { error: "Forbidden: only admin/finance can manage webhooks" });
      }
      const body = await parseJsonBody(req);
      const url = String(body.url || "").trim();
      const signingSecret = String(body.signingSecret || "").trim();
      if (!isAllowedWebhookUrl(url)) {
        return sendJson(res, 400, { error: "url must be https (or localhost http for local development)" });
      }
      if (!/^whsec_[A-Za-z0-9_-]{24,}$/.test(signingSecret)) {
        return sendJson(res, 400, { error: "signingSecret must start with whsec_ and be at least 24 chars" });
      }
      const endpoint = createWebhookEndpoint({
        merchantId: session.merchantId,
        accountId: session.accountId,
        url,
        signingSecret
      });
      return sendJson(res, 201, endpoint);
    }

    const onboardingWebhookItemMatch = pathname.match(ONBOARDING_WEBHOOK_ITEM_ROUTE);
    if (onboardingWebhookItemMatch) {
      const session = requireSession(req, res);
      if (!session) {
        return;
      }
      if (session.role !== "admin" && session.role !== "finance") {
        return sendJson(res, 403, { error: "Forbidden: only admin/finance can manage webhooks" });
      }
      const webhookId = decodeURIComponent(onboardingWebhookItemMatch[1] || "");
      if (!webhookId) {
        return sendJson(res, 400, { error: "webhookId is required" });
      }
      const existing = getWebhookEndpointById(session.merchantId, session.accountId, webhookId);
      if (!existing) {
        return sendJson(res, 404, { error: "Webhook endpoint not found" });
      }

      if (method === "PATCH") {
        const body = await parseJsonBody(req);
        const patch = {};
        if (body.url !== undefined) {
          const url = String(body.url || "").trim();
          if (!isAllowedWebhookUrl(url)) {
            return sendJson(res, 400, { error: "url must be https (or localhost http for local development)" });
          }
          patch.url = url;
        }
        if (body.status !== undefined) {
          const status = String(body.status || "").trim().toLowerCase();
          if (!["active", "disabled"].includes(status)) {
            return sendJson(res, 400, { error: "status must be active or disabled" });
          }
          patch.status = status;
        }
        if (!Object.keys(patch).length) {
          return sendJson(res, 400, { error: "Provide at least one editable field: url or status" });
        }
        const updated = updateWebhookEndpoint(session.merchantId, session.accountId, webhookId, patch);
        return sendJson(res, 200, updated);
      }

      if (method === "DELETE") {
        const deleted = deleteWebhookEndpoint(session.merchantId, session.accountId, webhookId);
        return sendJson(res, 200, {
          success: true,
          deleted
        });
      }

      return sendJson(res, 405, { error: "Method not allowed" });
    }

    if (method === "POST" && pathname === "/v1/onboarding/api-keys") {
      const session = requireSession(req, res);
      if (!session) {
        return;
      }
      if (session.role !== "admin" && session.role !== "finance") {
        return sendJson(res, 403, { error: "Forbidden: only admin/finance can create API keys" });
      }

      const body = await parseJsonBody(req);
      const providedName = String(body.name || "").trim();
      const keyName = providedName || `API Key ${new Date().toISOString()}`;
      const requestedRole = String(body.role || "").trim().toLowerCase();
      const keyRole = ["admin", "finance", "readonly"].includes(requestedRole)
        ? requestedRole
        : session.role === "admin"
          ? "admin"
          : "finance";

      const apiKey = createApiKey({
        merchantId: session.merchantId,
        accountId: session.accountId,
        name: keyName,
        role: keyRole,
        createdByUserId: session.userId
      });

      return sendJson(res, 201, {
        id: apiKey.id,
        name: apiKey.name,
        role: apiKey.role,
        keyPrefix: apiKey.keyPrefix,
        token: apiKey.token,
        createdAt: apiKey.createdAt
      });
    }

    const onboardingApiKeyItemMatch = pathname.match(/^\/v1\/onboarding\/api-keys\/([^/]+)(?:\/(revoke))?$/);
    if (onboardingApiKeyItemMatch) {
      const session = requireSession(req, res);
      if (!session) {
        return;
      }
      if (session.role !== "admin" && session.role !== "finance") {
        return sendJson(res, 403, { error: "Forbidden: only admin/finance can manage API keys" });
      }

      const keyId = decodeURIComponent(onboardingApiKeyItemMatch[1] || "");
      const operation = onboardingApiKeyItemMatch[2] || "";
      if (!keyId) {
        return sendJson(res, 400, { error: "apiKeyId is required" });
      }
      const existing = getApiKeyById(session.merchantId, session.accountId, keyId);
      if (!existing) {
        return sendJson(res, 404, { error: "API key not found" });
      }
      if (existing.role === "admin" && session.role !== "admin") {
        return sendJson(res, 403, { error: "Forbidden: only admin can manage admin API keys" });
      }

      if (method === "PATCH" && !operation) {
        const body = await parseJsonBody(req);
        const patch = {};
        if (body.name !== undefined) {
          const name = String(body.name || "").trim();
          if (!name) {
            return sendJson(res, 400, { error: "name cannot be empty" });
          }
          patch.name = name;
        }
        if (body.role !== undefined) {
          const role = String(body.role || "").trim().toLowerCase();
          if (!["admin", "finance", "readonly"].includes(role)) {
            return sendJson(res, 400, { error: "role must be admin, finance, or readonly" });
          }
          if (role === "admin" && session.role !== "admin") {
            return sendJson(res, 403, { error: "Forbidden: only admin can assign admin role" });
          }
          patch.role = role;
        }
        if (!Object.keys(patch).length) {
          return sendJson(res, 400, { error: "Provide at least one editable field: name or role" });
        }
        const updated = updateApiKeyMetadata(session.merchantId, session.accountId, keyId, patch);
        return sendJson(res, 200, updated);
      }

      if (method === "POST" && operation === "revoke") {
        if (existing.status !== "active") {
          return sendJson(res, 200, existing);
        }
        const activeCount = countActiveApiKeys(session.merchantId, session.accountId);
        if (activeCount <= 1) {
          return sendJson(res, 400, { error: "cannot revoke the last active API key" });
        }
        if (existing.role === "admin") {
          const activeAdminCount = countActiveApiKeysByRole(session.merchantId, session.accountId, "admin");
          if (activeAdminCount <= 1) {
            return sendJson(res, 400, { error: "cannot revoke the last active admin API key" });
          }
        }
        const revoked = revokeApiKeyById(session.merchantId, session.accountId, keyId);
        return sendJson(res, 200, revoked);
      }

      if (method === "DELETE" && !operation) {
        if (existing.status === "active") {
          return sendJson(res, 400, { error: "active API keys cannot be deleted; revoke first" });
        }
        const deleted = deleteRevokedApiKeyById(session.merchantId, session.accountId, keyId);
        if (!deleted) {
          return sendJson(res, 404, { error: "API key not found" });
        }
        return sendJson(res, 200, deleted);
      }

      return sendJson(res, 405, { error: "Method not allowed" });
    }

    if (method === "POST" && pathname === "/v1/onboarding/webhooks/test") {
      const session = requireSession(req, res);
      if (!session) {
        return;
      }
      if (session.role !== "admin" && session.role !== "finance") {
        return sendJson(res, 403, { error: "Forbidden: only admin/finance can manage webhooks" });
      }
      const result = await sendWebhookTestEvent({
        merchantId: session.merchantId,
        accountId: session.accountId
      });
      return sendJson(res, 200, result);
    }

    if (method === "POST" && pathname === "/v1/onboarding/products") {
      const session = requireSession(req, res);
      if (!session) {
        return;
      }
      if (session.role !== "admin" && session.role !== "finance") {
        return sendJson(res, 403, { error: "Forbidden: only admin/finance can manage products" });
      }

      const body = await parseJsonBody(req);
      const apiId = String(body.apiId || "").trim();
      const apiName = String(body.apiName || "").trim();
      const routeMethod = normalizeHttpMethod(body.method || "GET");
      const routePath = normalizeRoutePath(body.path);
      const sourceNetwork = normalizeSourceNetworkPreference(body.sourceNetwork);
      if (!apiId || !apiName || !routePath) {
        return sendJson(res, 400, {
          error: "apiId, apiName, method, and path are required"
        });
      }
      const existingRoute = getApiProductByMethodPath(session.merchantId, session.accountId, routeMethod, routePath);
      if (existingRoute) {
        return sendJson(res, 409, {
          error: "A product already exists for this method and path"
        });
      }
      const existingApiId = getApiProductByApiId(session.merchantId, session.accountId, apiId);
      if (existingApiId) {
        return sendJson(res, 409, {
          error: "API ID already exists. Use a unique API ID for each product."
        });
      }
      let amount;
      try {
        amount = parsePositiveUsdcToBaseUnits(body.amountUsdc || "0.01", "amountUsdc");
      } catch (error) {
        return sendJson(res, 400, {
          error: error instanceof Error ? error.message : "Invalid amountUsdc"
        });
      }
      let destinationNetwork = body.destinationNetwork ? String(body.destinationNetwork).trim() : null;
      const settlementModeInput = String(body.settlementMode || "").trim().toLowerCase();
      const settlementMode =
        settlementModeInput === "cross_chain"
          ? "cross_chain"
          : "same_chain";
      if (settlementMode === "same_chain") {
        destinationNetwork = null;
      }
      if (!isSourceNetworkAny(sourceNetwork)) {
        const sourceWallet = getWalletByNetwork(session.merchantId, session.accountId, sourceNetwork);
        if (!sourceWallet) {
          return sendJson(res, 400, { error: "source network wallet not found for merchant account" });
        }
      }
      if (destinationNetwork) {
        const destinationWallet = getWalletByNetwork(session.merchantId, session.accountId, destinationNetwork);
        if (!destinationWallet) {
          return sendJson(res, 400, { error: "destination wallet not found for merchant account" });
        }
      }

      const created = createApiProduct({
        merchantId: session.merchantId,
        accountId: session.accountId,
        apiId,
        apiName,
        description: body.description ? String(body.description) : null,
        method: routeMethod,
        path: routePath,
        sourceNetwork,
        sourceAsset: sourceNetwork === SOURCE_NETWORK_ANY ? "USDC" : null,
        amount: amount.toString(),
        settlementMode,
        destinationNetwork,
        destinationAsset: null,
        enabled: true
      });
      return sendJson(res, 201, created);
    }

    if (method === "POST" && pathname === "/v1/internal/events/settlements") {
      if (!validateIngestToken(req)) {
        return sendJson(res, 401, { error: "Unauthorized ingest token" });
      }

      const body = await parseJsonBody(req);
      const merchantId = String(body.merchantId || "").trim();
      const accountId = String(body.accountId || "").trim();
      const paymentContextId = body.paymentContextId ? String(body.paymentContextId).trim() : "";
      const sourceNetwork = String(body.sourceNetwork || "").trim();
      const destinationNetwork = body.destinationNetwork ? String(body.destinationNetwork).trim() : null;
      const scheme = body.scheme ? String(body.scheme).trim() : "exact";
      const status = String(body.status || "").trim();
      const txHash = String(body.txHash || "").trim();
      const amount = String(body.amount || "").trim();
      const publicPayTo = body.publicPayTo ? String(body.publicPayTo).trim() : "";
      const failReason = body.failReason ? sanitizeFailReason(String(body.failReason).trim()) : null;
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

      let resolvedMerchantId = merchantId;
      let resolvedAccountId = accountId;
      let resolvedPaymentContext = null;

      const acceptedStatuses = new Set(["settled_source", "bridge_pending", "bridge_confirmed", "failed"]);
      if ((!resolvedMerchantId || !resolvedAccountId) && !paymentContextId) {
        return sendJson(res, 400, {
          error: "merchantId/accountId or paymentContextId are required"
        });
      }
      if (!sourceNetwork || !txHash || !amount) {
        return sendJson(res, 400, { error: "sourceNetwork, amount, txHash are required" });
      }
      if (!acceptedStatuses.has(status)) {
        return sendJson(res, 400, { error: "invalid status" });
      }
      const normalizedAsset = normalizeUsdcAsset(body.asset);
      if (!normalizedAsset) {
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

      if (paymentContextId) {
        if (!publicPayTo) {
          return sendJson(res, 400, { error: "publicPayTo is required when paymentContextId is provided" });
        }
        const resolved = resolvePaymentRequirementContextForSettlement({
          paymentContextId,
          settlementId,
          scheme,
          sourceNetwork,
          asset: normalizedAsset,
          amount,
          publicPayTo
        });
        if (!resolved.ok) {
          return sendJson(res, 400, {
            error: resolved.error,
            code: resolved.code,
            paymentContextId
          });
        }
        resolvedPaymentContext = resolved.context;
        resolvedMerchantId = resolved.context.merchantId;
        resolvedAccountId = resolved.context.accountId;
      }

      if (!ensureAccountExists(res, resolvedMerchantId, resolvedAccountId)) {
        return;
      }

      const duplicate = hasSettlementEvent(eventId);
      const duplicateLifecycle = hasSettlementLifecycleEvent(
        resolvedMerchantId,
        resolvedAccountId,
        settlementId,
        status
      );
      if (!duplicate && !duplicateLifecycle) {
        insertSettlementEvent({
          eventId,
          settlementId,
          merchantId: resolvedMerchantId,
          accountId: resolvedAccountId,
          sourceNetwork,
          destinationNetwork,
          apiId,
          apiRoute,
          apiName,
          amount,
          status,
          failReason,
          txHash,
          sourceTxHash,
          bridgeTxHash,
          destinationTxHash,
          blockNumber,
          logIndex,
          confirmations,
          createdAt
        });
        recomputeBalances(resolvedMerchantId, resolvedAccountId);

        const eventTypeByStatus = {
          settled_source: "payment.settled_source",
          bridge_pending: "payment.bridge_pending",
          bridge_confirmed: "payment.bridge_confirmed",
          failed: "payment.failed"
        };
        const webhookEventType = eventTypeByStatus[status] || "payment.updated";
        await publishTenantWebhookEvent({
          merchantId: resolvedMerchantId,
          accountId: resolvedAccountId,
          eventType: webhookEventType,
          eventId: `evt_${eventId}_${status}`,
          data: {
            eventId,
            settlementId,
            merchantId: resolvedMerchantId,
            accountId: resolvedAccountId,
            paymentContextId: paymentContextId || null,
            treasuryMode: resolvedPaymentContext?.treasuryMode || null,
            privacyCoverageMode: resolvedPaymentContext?.privacyCoverageMode || null,
            sourceNetwork,
            destinationNetwork,
            asset: "USDC",
            amount,
            status,
            failReason,
            txHash,
            sourceTxHash,
            bridgeTxHash,
            destinationTxHash,
            confirmations
          }
        });
      }

      return sendJson(res, 200, {
        success: true,
        duplicate: duplicate || duplicateLifecycle,
        eventId,
        settlementId,
        paymentContextId: paymentContextId || null,
        merchantId: resolvedMerchantId || null,
        accountId: resolvedAccountId || null
      });
    }

    if (method === "GET" && pathname === "/v1/sdk/context") {
      const key = requireApiKey(req, res);
      if (!key) {
        return;
      }
      const settings = buildTenantSettingsPayload(key.merchantId, key.accountId);
      return sendJson(res, 200, {
        merchantId: key.merchantId,
        accountId: key.accountId,
        merchantName: settings.merchantName || "",
        accountName: settings.accountName || "",
      });
    }

    if (method === "POST" && pathname === "/v1/sdk/requirements/resolve") {
      const key = requireApiKey(req, res);
      if (!key) {
        return;
      }

      const body = await parseJsonBody(req);
      const apiProductId = body.apiProductId ? String(body.apiProductId).trim() : "";
      const apiId = body.apiId ? String(body.apiId).trim() : "";
      const routeMethod = normalizeHttpMethod(body.method || "GET");
      const routePath = normalizeRoutePath(body.path || "/api/premium");
      const settlementModeOverride =
        body.settlementModeOverride === undefined || body.settlementModeOverride === null
          ? null
          : String(body.settlementModeOverride).trim();

      const resolved = resolvePaymentRequirementsForTenant({
        merchantId: key.merchantId,
        accountId: key.accountId,
        apiProductId,
        apiId,
        routeMethod,
        routePath,
        settlementModeOverride
      });
      return sendJson(res, resolved.status, resolved.payload);
    }

    if (method === "POST" && pathname === "/v1/internal/requirements/resolve") {
      if (!validateInternalToken(req)) {
        return sendJson(res, 401, { error: "Unauthorized internal token" });
      }

      const body = await parseJsonBody(req);
      const merchantId = String(body.merchantId || "").trim();
      const accountId = String(body.accountId || "").trim();
      if (!merchantId || !accountId) {
        return sendJson(res, 400, { error: "merchantId and accountId are required" });
      }
      if (!ensureAccountExists(res, merchantId, accountId)) {
        return;
      }
      const apiProductId = body.apiProductId ? String(body.apiProductId).trim() : "";
      const apiId = body.apiId ? String(body.apiId).trim() : "";
      const routeMethod = normalizeHttpMethod(body.method || "GET");
      const routePath = normalizeRoutePath(body.path || "/api/premium");
      const settlementModeOverride =
        body.settlementModeOverride === undefined || body.settlementModeOverride === null
          ? null
          : String(body.settlementModeOverride).trim();

      const resolved = resolvePaymentRequirementsForTenant({
        merchantId,
        accountId,
        apiProductId,
        apiId,
        routeMethod,
        routePath,
        settlementModeOverride
      });
      return sendJson(res, resolved.status, resolved.payload);
    }

    if (method === "POST" && pathname === "/v1/internal/private-accounts") {
      if (!validateInternalToken(req)) {
        return sendJson(res, 401, { error: "Unauthorized internal token" });
      }

      const body = await parseJsonBody(req);
      const merchantId = String(body.merchantId || "").trim();
      const accountId = String(body.accountId || "").trim();
      const network = String(body.network || "").trim();
      const provider = String(body.provider || "unlink").trim() || "unlink";
      const environment =
        String(body.environment || "").trim() ||
        privacyVaultService.getEnvironmentForNetwork(network) ||
        "";
      const role = String(body.role || "merchant").trim() || "merchant";
      const unlinkAddress = body.unlinkAddress ? String(body.unlinkAddress).trim() : "";
      const keyReference = body.keyReference ? String(body.keyReference).trim() : null;

      if (!merchantId || !accountId || !network || !environment) {
        return sendJson(res, 400, {
          error: "merchantId, accountId, network, and environment are required"
        });
      }
      if (!ensureAccountExists(res, merchantId, accountId)) {
        return;
      }

      const saved = upsertPrivateAccount({
        merchantId,
        accountId,
        provider,
        environment,
        network,
        role,
        unlinkAddress: unlinkAddress || null,
        keyReference
      });

      return sendJson(res, 200, {
        success: true,
        privateAccount: saved
      });
    }

    const merchantItemProductMatch = pathname.match(MERCHANT_PRODUCTS_ITEM_ROUTE);
    if (merchantItemProductMatch && (method === "PUT" || method === "DELETE")) {
      const merchantId = decodeURIComponent(merchantItemProductMatch[1]);
      const apiProductId = decodeURIComponent(merchantItemProductMatch[2]);
      const key = requireApiKey(req, res);
      if (!key) {
        return;
      }
      if (key.merchantId !== merchantId) {
        return sendJson(res, 403, { error: "Forbidden: merchant mismatch" });
      }

      const existing = getApiProductById(key.merchantId, key.accountId, apiProductId);
      if (!existing) {
        return sendJson(res, 404, { error: "API product not found" });
      }
      if (method === "DELETE") {
        const deleted = deleteApiProduct(key.merchantId, key.accountId, apiProductId);
        return sendJson(res, 200, {
          success: true,
          deleted
        });
      }
      const body = await parseJsonBody(req);

      const patch = {};
      if (body.apiId !== undefined) {
        const apiId = String(body.apiId || "").trim();
        if (!apiId) {
          return sendJson(res, 400, { error: "apiId cannot be empty" });
        }
        patch.apiId = apiId;
      }
      if (body.apiName !== undefined) {
        patch.apiName = String(body.apiName || "").trim();
      }
      if (body.description !== undefined) {
        patch.description = body.description === null ? null : String(body.description);
      }
      if (body.enabled !== undefined) {
        patch.enabled = Boolean(body.enabled);
      }
      if (body.amountUsdc !== undefined) {
        try {
          patch.amount = parsePositiveUsdcToBaseUnits(body.amountUsdc, "amountUsdc").toString();
        } catch (error) {
          return sendJson(res, 400, {
            error: error instanceof Error ? error.message : "Invalid amountUsdc"
          });
        }
      }
      if (body.method !== undefined) {
        const method = normalizeHttpMethod(body.method || "");
        if (!method) {
          return sendJson(res, 400, { error: "method cannot be empty" });
        }
        patch.method = method;
      }
      if (body.path !== undefined) {
        const path = normalizeRoutePath(body.path || "");
        if (!path) {
          return sendJson(res, 400, { error: "path cannot be empty" });
        }
        patch.path = path;
      }
      if (body.sourceNetwork !== undefined) {
        patch.sourceNetwork = normalizeSourceNetworkPreference(body.sourceNetwork);
      }
      if (body.settlementMode !== undefined) {
        const settlementMode = String(body.settlementMode || "").trim().toLowerCase();
        if (!["same_chain", "cross_chain"].includes(settlementMode)) {
          return sendJson(res, 400, { error: "settlementMode must be same_chain or cross_chain" });
        }
        patch.settlementMode = settlementMode;
      }
      if (body.destinationNetwork !== undefined) {
        patch.destinationNetwork = body.destinationNetwork ? String(body.destinationNetwork).trim() : null;
      }
      const nextMethod = patch.method || existing.method;
      const nextPath = patch.path || existing.path;
      if (nextMethod !== existing.method || nextPath !== existing.path) {
        const duplicate = getApiProductByMethodPath(key.merchantId, key.accountId, nextMethod, nextPath);
        if (duplicate && duplicate.id !== existing.id) {
          return sendJson(res, 409, {
            error: "A product already exists for this method and path"
          });
        }
      }
      if (patch.apiId !== undefined) {
        const duplicateApiId = getApiProductByApiId(key.merchantId, key.accountId, patch.apiId);
        if (duplicateApiId && duplicateApiId.id !== existing.id) {
          return sendJson(res, 409, {
            error: "API ID already exists. Use a unique API ID for each product."
          });
        }
      }
      const nextSourceNetwork = patch.sourceNetwork !== undefined ? patch.sourceNetwork : existing.sourceNetwork;
      const nextSettlementMode = patch.settlementMode || existing.settlementMode;
      let nextDestinationNetwork =
        patch.destinationNetwork !== undefined ? patch.destinationNetwork : existing.destinationNetwork;
      if (nextSettlementMode === "same_chain") {
        nextDestinationNetwork = null;
        patch.destinationNetwork = null;
      }
      if (!isSourceNetworkAny(nextSourceNetwork)) {
        const sourceWallet = getWalletByNetwork(key.merchantId, key.accountId, nextSourceNetwork);
        if (!sourceWallet) {
          return sendJson(res, 400, { error: "source network wallet not found for merchant account" });
        }
      }
      if (nextDestinationNetwork) {
        const destinationWallet = getWalletByNetwork(key.merchantId, key.accountId, nextDestinationNetwork);
        if (!destinationWallet) {
          return sendJson(res, 400, { error: "destination wallet not found for merchant account" });
        }
      }
      const updated = updateApiProduct(key.merchantId, key.accountId, apiProductId, patch);
      return sendJson(res, 200, updated);
    }

    const merchantPayoutAddressBookItemMatch = pathname.match(MERCHANT_PAYOUT_ADDRESS_BOOK_ITEM_ROUTE);
    if (merchantPayoutAddressBookItemMatch && (method === "PUT" || method === "DELETE")) {
      const merchantId = decodeURIComponent(merchantPayoutAddressBookItemMatch[1]);
      const entryId = decodeURIComponent(merchantPayoutAddressBookItemMatch[2]);
      const key = requireApiKey(req, res);
      if (!key) {
        return;
      }
      if (key.merchantId !== merchantId) {
        return sendJson(res, 403, { error: "Forbidden: merchant mismatch" });
      }

      const existing = getPayoutAddressBookEntryById(key.merchantId, key.accountId, entryId);
      if (!existing) {
        return sendJson(res, 404, { error: "Saved payout address not found" });
      }

      if (method === "DELETE") {
        const deleted = deletePayoutAddressBookEntry(key.merchantId, key.accountId, entryId);
        return sendJson(res, 200, {
          success: true,
          deleted
        });
      }

      const body = await parseJsonBody(req);
      const patch = {};
      if (body.label !== undefined) {
        const label = String(body.label || "").trim();
        if (label.length < 2) {
          return sendJson(res, 400, { error: "label must be at least 2 characters" });
        }
        patch.label = label;
      }
      if (body.network !== undefined) {
        const network = String(body.network || "").trim();
        if (!network) {
          return sendJson(res, 400, { error: "network is required" });
        }
        patch.network = network;
      }
      if (body.address !== undefined) {
        const address = normalizeEvmAddress(body.address);
        if (!address) {
          return sendJson(res, 400, { error: "address must be a valid EVM address" });
        }
        patch.address = address;
      }
      if (!Object.keys(patch).length) {
        return sendJson(res, 400, { error: "Provide at least one editable field: label, network, or address" });
      }

      const nextNetwork = patch.network || existing.network;
      const nextAddress = patch.address || existing.address;
      const duplicate = findPayoutAddressBookEntryByNetworkAddress(
        key.merchantId,
        key.accountId,
        nextNetwork,
        nextAddress
      );
      if (duplicate && duplicate.id !== existing.id) {
        return sendJson(res, 409, {
          error: "A saved address already exists for this network and wallet address"
        });
      }

      const updated = updatePayoutAddressBookEntry(key.merchantId, key.accountId, entryId, patch);
      return sendJson(res, 200, updated);
    }

    const merchantPayoutAddressBookMatch = pathname.match(MERCHANT_PAYOUT_ADDRESS_BOOK_ROUTE);
    if (merchantPayoutAddressBookMatch) {
      const merchantId = decodeURIComponent(merchantPayoutAddressBookMatch[1]);
      const key = requireApiKey(req, res);
      if (!key) {
        return;
      }
      if (key.merchantId !== merchantId) {
        return sendJson(res, 403, { error: "Forbidden: merchant mismatch" });
      }

      if (method === "GET") {
        return sendJson(res, 200, {
          merchantId: key.merchantId,
          accountId: key.accountId,
          items: listPayoutAddressBookEntries(key.merchantId, key.accountId)
        });
      }

      if (method === "POST") {
        const body = await parseJsonBody(req);
        const label = String(body.label || "").trim();
        const network = String(body.network || "").trim();
        const address = normalizeEvmAddress(body.address);
        if (label.length < 2) {
          return sendJson(res, 400, { error: "label must be at least 2 characters" });
        }
        if (!network) {
          return sendJson(res, 400, { error: "network is required" });
        }
        if (!address) {
          return sendJson(res, 400, { error: "address must be a valid EVM address" });
        }

        const entry = upsertPayoutAddressBookEntry({
          merchantId: key.merchantId,
          accountId: key.accountId,
          label,
          network,
          address
        });
        return sendJson(res, 201, entry);
      }

      return sendJson(res, 405, { error: "Method not allowed" });
    }

    const merchantConsolidationEstimateMatch = pathname.match(MERCHANT_CONSOLIDATIONS_ESTIMATE_ROUTE);
    if (merchantConsolidationEstimateMatch) {
      const merchantId = decodeURIComponent(merchantConsolidationEstimateMatch[1]);
      const key = requireApiKey(req, res);
      if (!key) {
        return;
      }
      if (key.merchantId !== merchantId) {
        return sendJson(res, 403, { error: "Forbidden: merchant mismatch" });
      }
      if (method !== "POST") {
        return sendJson(res, 405, { error: "Method not allowed" });
      }

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

      const estimate = await buildConsolidationEstimatePreview({
        merchantId: key.merchantId,
        accountId: key.accountId,
        sourceNetwork,
        destinationNetwork,
        normalizedAsset,
        amount
      });
      return sendJson(res, estimate.statusCode, estimate.payload);
    }

    const merchantConsolidationItemMatch = pathname.match(MERCHANT_CONSOLIDATION_ITEM_ROUTE);
    if (merchantConsolidationItemMatch) {
      const merchantId = decodeURIComponent(merchantConsolidationItemMatch[1]);
      const consolidationId = decodeURIComponent(merchantConsolidationItemMatch[2]);
      const key = requireApiKey(req, res);
      if (!key) {
        return;
      }
      if (key.merchantId !== merchantId) {
        return sendJson(res, 403, { error: "Forbidden: merchant mismatch" });
      }
      if (method !== "GET") {
        return sendJson(res, 405, { error: "Method not allowed" });
      }

      const consolidation = getConsolidation(consolidationId);
      if (!consolidation) {
        return sendJson(res, 404, { error: "Consolidation not found" });
      }
      if (consolidation.merchantId !== key.merchantId || consolidation.accountId !== key.accountId) {
        return sendJson(res, 404, { error: "Consolidation not found" });
      }
      return sendJson(res, 200, consolidation);
    }

    const merchantMatch = pathname.match(MERCHANT_ROUTE);
    if (merchantMatch) {
      const merchantId = decodeURIComponent(merchantMatch[1]);
      const action = merchantMatch[2];
      const key = requireApiKey(req, res);
      if (!key) {
        return;
      }
      if (key.merchantId !== merchantId) {
        return sendJson(res, 403, { error: "Forbidden: merchant mismatch" });
      }

      if (method === "GET" && action === "balances") {
        const onchainMode = parseBalancesOnchainMode(requestUrl.searchParams);
        const overview = await buildOverviewResponse(key.merchantId, key.accountId, {
          onchainMode
        });
        return sendJson(res, 200, {
          merchantId: key.merchantId,
          accountId: key.accountId,
          asOf: overview.asOf,
          onchainMode: overview.onchainMode,
          treasuryMode: overview.policy?.treasuryMode || "public",
          availableUsd: overview.availableUsd,
          projectedUsd: overview.projectedUsd,
          pendingBridgeUsd: overview.pendingBridgeUsd,
          pendingSweepUsd: overview.pendingSweepUsd || "0",
          pendingWithdrawalUsd: overview.pendingWithdrawalUsd || "0",
          balanceFreshness: overview.balanceFreshness || null,
          lastProviderSyncAt: overview.lastProviderSyncAt || null,
          balances: overview.balances
        });
      }

      if (method === "GET" && action === "settlements") {
        const timelineQuery = parseTimelineQuery(requestUrl.searchParams);
        const timeline = queryTimeline(key.merchantId, key.accountId, timelineQuery);
        return sendJson(res, 200, {
          merchantId: key.merchantId,
          accountId: key.accountId,
          asOf: nowIso(),
          items: timeline.items,
          pagination: {
            page: timeline.page,
            pageSize: timeline.pageSize,
            total: timeline.total,
            totalPages: timeline.totalPages,
            hasNextPage: timeline.hasNextPage,
            hasPreviousPage: timeline.hasPreviousPage
          },
          filters: {
            type: timelineQuery.itemTypes,
            dateFrom: timelineQuery.createdFrom || null,
            dateTo: timelineQuery.createdTo || null
          }
        });
      }

      if (action === "products" && method === "GET") {
        return sendJson(res, 200, {
          merchantId: key.merchantId,
          accountId: key.accountId,
          items: listApiProducts(key.merchantId, key.accountId)
        });
      }

      if (action === "products" && method === "POST") {
        if (!requireRole(res, key, ["admin", "finance"])) {
          return;
        }
        const body = await parseJsonBody(req);
        const apiId = String(body.apiId || "").trim();
        const apiName = String(body.apiName || "").trim();
        const routeMethod = normalizeHttpMethod(body.method || "GET");
        const routePath = normalizeRoutePath(body.path);
        const sourceNetwork = normalizeSourceNetworkPreference(body.sourceNetwork);
        if (!apiId || !apiName || !routePath) {
          return sendJson(res, 400, {
            error: "apiId, apiName, method, and path are required"
          });
        }
        const existingRoute = getApiProductByMethodPath(key.merchantId, key.accountId, routeMethod, routePath);
        if (existingRoute) {
          return sendJson(res, 409, {
            error: "A product already exists for this method and path"
          });
        }
        const existingApiId = getApiProductByApiId(key.merchantId, key.accountId, apiId);
        if (existingApiId) {
          return sendJson(res, 409, {
            error: "API ID already exists. Use a unique API ID for each product."
          });
        }

        let amount;
        try {
          amount =
            body.amountUsdc !== undefined
              ? parsePositiveUsdcToBaseUnits(body.amountUsdc, "amountUsdc")
              : parsePositiveBigInt(body.amount || "0", "amount");
        } catch (error) {
          return sendJson(res, 400, {
            error: error instanceof Error ? error.message : "Invalid amount"
          });
        }

        const settlementModeInput = String(body.settlementMode || "").trim().toLowerCase();
        const settlementMode =
          settlementModeInput === "cross_chain"
            ? "cross_chain"
            : "same_chain";
        let destinationNetwork = body.destinationNetwork ? String(body.destinationNetwork).trim() : null;
        if (settlementMode === "same_chain") {
          destinationNetwork = null;
        }
        if (!isSourceNetworkAny(sourceNetwork)) {
          const sourceWallet = getWalletByNetwork(key.merchantId, key.accountId, sourceNetwork);
          if (!sourceWallet) {
            return sendJson(res, 400, { error: "source network wallet not found for merchant account" });
          }
        }
        if (destinationNetwork) {
          const destinationWallet = getWalletByNetwork(key.merchantId, key.accountId, destinationNetwork);
          if (!destinationWallet) {
            return sendJson(res, 400, { error: "destination wallet not found for merchant account" });
          }
        }
        const created = createApiProduct({
          merchantId: key.merchantId,
          accountId: key.accountId,
          apiId,
          apiName,
          description: body.description ? String(body.description) : null,
          method: routeMethod,
          path: routePath,
          sourceNetwork,
          sourceAsset: sourceNetwork === SOURCE_NETWORK_ANY ? "USDC" : null,
          amount: amount.toString(),
          settlementMode,
          destinationNetwork,
          destinationAsset: null,
          enabled: body.enabled === undefined ? true : Boolean(body.enabled)
        });
        return sendJson(res, 201, created);
      }

      if (action === "consolidations" && method === "GET") {
        return sendJson(res, 200, {
          merchantId: key.merchantId,
          accountId: key.accountId,
          asOf: nowIso(),
          items: getTimeline(key.merchantId, key.accountId, 200).filter((item) => item.itemType === "consolidation")
        });
      }

      if (action === "consolidations" && method === "POST") {
        if (!requireRole(res, key, ["admin", "finance"])) {
          return;
        }
        const lockHandle = acquireTenantMutationLock(`consolidation:${key.merchantId}:${key.accountId}`);
        if (!lockHandle) {
          return sendJson(res, 409, {
            error: "Another consolidation request is already in progress for this account"
          });
        }
        try {
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

        const sourceWallet = getWalletByNetwork(key.merchantId, key.accountId, sourceNetwork);
        if (!sourceWallet) {
          return sendJson(res, 400, { error: "source network wallet not found" });
        }
        const destinationWallet = getWalletByNetwork(key.merchantId, key.accountId, destinationNetwork);
        if (!destinationWallet) {
          return sendJson(res, 400, { error: "destination network wallet not found" });
        }

        const sourceBalanceInfo = await getEffectiveNetworkUsdcBalance({
          merchantId: key.merchantId,
          accountId: key.accountId,
          network: sourceNetwork,
          wallet: sourceWallet,
          strictOnchain: config.realConsolidationBridgeEnabled
        });
        if (sourceBalanceInfo.amount < amount) {
          return sendJson(res, 400, {
            error: "insufficient source balance",
            available: sourceBalanceInfo.amount.toString(),
            availableSource: sourceBalanceInfo.source,
            availableProjected: sourceBalanceInfo.projectedAmount.toString(),
            availableOnchain: sourceBalanceInfo.onchainAmount === null ? null : sourceBalanceInfo.onchainAmount.toString()
          });
        }

        let sourcePrivateKey = null;
        let destinationPrivateKey = null;

        if (config.realConsolidationBridgeEnabled) {
          sourcePrivateKey = getCustodyPrivateKeyByReference(
            key.merchantId,
            key.accountId,
            sourceWallet.keyReference
          );
          if (!sourcePrivateKey) {
            return sendJson(res, 500, {
              error: `Missing custody key for source wallet reference: ${sourceWallet.keyReference}`
            });
          }

          destinationPrivateKey =
            getCustodyPrivateKeyByReference(key.merchantId, key.accountId, destinationWallet.keyReference) ||
            sourcePrivateKey;
          if (!destinationPrivateKey) {
            return sendJson(res, 500, {
              error: `Missing custody key for destination wallet reference: ${destinationWallet.keyReference}`
            });
          }

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

          const [fallbackSourceGasRequirement, fallbackDestinationGasRequirement] = await Promise.all([
            estimateRequiredBridgeGas({
              network: sourceNetwork,
              role: "source"
            }),
            estimateRequiredBridgeGas({
              network: destinationNetwork,
              role: "destination"
            })
          ]);

          let sourceGasRequirement = fallbackSourceGasRequirement;
          let destinationGasRequirement = fallbackDestinationGasRequirement;

          try {
            const bridgeKitEstimate = await consolidationBridgeService.estimateGasRequirements({
              sourceNetwork,
              destinationNetwork,
              destinationAddress: destinationWallet.address,
              amount: amount.toString(),
              asset: normalizedAsset,
              sourcePrivateKey,
              destinationPrivateKey
            });

            if (bridgeKitEstimate?.sourceNetwork?.estimatedFeeWei !== undefined) {
              sourceGasRequirement = buildBridgeKitGasRequirement({
                network: sourceNetwork,
                role: "source",
                estimateEntry: bridgeKitEstimate.sourceNetwork
              });
            }
            if (bridgeKitEstimate?.destinationNetwork?.estimatedFeeWei !== undefined) {
              destinationGasRequirement = buildBridgeKitGasRequirement({
                network: destinationNetwork,
                role: "destination",
                estimateEntry: bridgeKitEstimate.destinationNetwork
              });
            }

            console.info("[merchant-os] consolidation bridge gas estimate resolved", {
              sourceNetwork,
              destinationNetwork,
              sourceEstimatorMode: sourceGasRequirement.mode,
              sourceEstimatedFeeWei:
                sourceGasRequirement.estimatedFeeWei?.toString?.() || null,
              sourceRequiredWei: sourceGasRequirement.requiredWei.toString(),
              destinationEstimatorMode: destinationGasRequirement.mode,
              destinationEstimatedFeeWei:
                destinationGasRequirement.estimatedFeeWei?.toString?.() || null,
              destinationRequiredWei: destinationGasRequirement.requiredWei.toString()
            });
          } catch (error) {
            console.warn("[merchant-os] Bridge Kit estimate failed; falling back to legacy gas heuristic", {
              sourceNetwork,
              destinationNetwork,
              error: error instanceof Error ? error.message : String(error)
            });
          }

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
        }

        const consolidationId = createConsolidation({
          merchantId: key.merchantId,
          accountId: key.accountId,
          sourceNetwork,
          destinationNetwork,
          amount: amount.toString()
        });

        updateConsolidationStatus(consolidationId, "submitted");
        const submittedConsolidation = getConsolidation(consolidationId);
        await publishTenantWebhookEvent({
          merchantId: key.merchantId,
          accountId: key.accountId,
          eventType: "consolidation.submitted",
          eventId: `evt_${consolidationId}_submitted`,
          data: submittedConsolidation
        });

        if (config.realConsolidationBridgeEnabled) {
          runConsolidationBridgeAsync({
            consolidationId,
            merchantId: key.merchantId,
            accountId: key.accountId,
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
          recomputeBalances(key.merchantId, key.accountId);
        }

        const created = getConsolidation(consolidationId);
        return sendJson(res, 202, {
          ...created,
          statusPath: `/v1/merchants/${encodeURIComponent(key.merchantId)}/consolidations/${encodeURIComponent(consolidationId)}`
        });
        } finally {
          releaseTenantMutationLock(lockHandle);
        }
      }

      if (action === "payouts" && method === "GET") {
        const timelineQuery = parseTimelineQuery(requestUrl.searchParams);
        const timeline = queryTimeline(key.merchantId, key.accountId, {
          ...timelineQuery,
          itemTypes: ["payout"]
        });
        return sendJson(res, 200, {
          merchantId: key.merchantId,
          accountId: key.accountId,
          asOf: nowIso(),
          items: timeline.items,
          pagination: {
            page: timeline.page,
            pageSize: timeline.pageSize,
            total: timeline.total,
            totalPages: timeline.totalPages,
            hasNextPage: timeline.hasNextPage,
            hasPreviousPage: timeline.hasPreviousPage
          }
        });
      }

      if (action === "payouts" && method === "POST") {
        if (!requireRole(res, key, ["admin", "finance"])) {
          return;
        }
        const lockHandle = acquireTenantMutationLock(`payout:${key.merchantId}:${key.accountId}`);
        if (!lockHandle) {
          return sendJson(res, 409, {
            error: "Another payout request is already in progress for this account"
          });
        }
        try {
        const body = await parseJsonBody(req);
        const network = String(body.network || "").trim();
        const destinationAddress = String(body.destinationAddress || "").trim();
        const normalizedAsset = normalizeUsdcAsset(body.asset || "USDC");
        if (!network || !/^0x[a-fA-F0-9]{40}$/.test(destinationAddress)) {
          return sendJson(res, 400, {
            error: "network and valid destinationAddress are required"
          });
        }
        if (!normalizedAsset) {
          return sendJson(res, 400, { error: "USDC-only: unsupported asset" });
        }

        let amount;
        try {
          amount =
            body.amountUsdc !== undefined
              ? parsePositiveUsdcToBaseUnits(body.amountUsdc, "amountUsdc")
              : parsePositiveBigInt(body.amount || "0", "amount");
        } catch (error) {
          return sendJson(res, 400, {
            error: error instanceof Error ? error.message : "Invalid amount"
          });
        }

        const result = await executePayout({
          merchantId: key.merchantId,
          accountId: key.accountId,
          network,
          amount,
          destinationAddress
        });
        if (!result.ok) {
          return sendJson(res, result.statusCode, result.payload);
        }

        touchPayoutAddressBookEntryUsedByNetworkAddress(
          key.merchantId,
          key.accountId,
          network,
          destinationAddress
        );

        return sendJson(res, result.statusCode, result.payout);
        } finally {
          releaseTenantMutationLock(lockHandle);
        }
      }

      if (action === "settings" && method === "GET") {
        return sendJson(res, 200, buildTenantSettingsPayload(key.merchantId, key.accountId));
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
      const normalizedPathname = `/${String(pathname || "").replace(/^\/+/, "")}`;
      const destination = `${config.webUrl}${normalizedPathname}${requestUrl.search || ""}`;
      res.writeHead(302, { location: destination });
      res.end();
      return;
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    const statusCode = Number(error?.statusCode || 0);
    if (statusCode === 400 || statusCode === 413) {
      return sendJson(res, statusCode, {
        error: error.message
      });
    }
    console.error("[merchant-os] unhandled request error", {
      method,
      pathname,
      error: error instanceof Error ? error.message : String(error)
    });
    return sendJson(res, 500, {
      error: "Internal server error"
    });
  }
});

initializeDatabase();
chainCatalogService.start();

server.listen(config.port, () => {
  console.log(`Merchant OS listening on http://localhost:${config.port}`);
  console.log(`Health: http://localhost:${config.port}/health`);
  console.log(`Frontend redirect: ${config.webUrl}`);
  console.log(`Chain catalog entries: ${listChainCatalog().length}`);
  const loginIdentities = listWorkspaceLoginIdentities();
  if (!loginIdentities.length) {
    console.log("Workspace logins: none found. Create one via POST /v1/onboarding/start.");
    return;
  }
  console.log(`Workspace logins: ${loginIdentities.length} active user(s).`);
  console.log("Use /v1/onboarding/settings (authenticated) to view tenant-specific identity details.");
});
