import { createHash } from "node:crypto";
import { config } from "./config.js";
import {
  getLatestPrivateBalanceSnapshot,
  getPrivateAccount,
  insertPrivateBalanceSnapshot,
  upsertPrivateAccount
} from "./db.js";

const DEFAULT_PROVIDER = "unlink";
const DEFAULT_TOKEN = "USDC";

const simulationEnabled = () => Boolean(config.allowSimulatedLedgerMutations);

const loadUnlinkSdk = async () => {
  try {
    return await import("@unlink-xyz/sdk/server");
  } catch (error) {
    return {
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
};

const resolveEnvironmentForNetwork = (network) => {
  const direct = config.unlinkEnvironmentByNetwork?.[network];
  if (direct) {
    return String(direct).trim();
  }
  return config.unlinkDefaultEnvironment || null;
};

const hashSuffix = (value) =>
  createHash("sha256")
    .update(String(value || ""))
    .digest("hex")
    .slice(0, 24);

const buildSimulatedUnlinkAddress = (seed) => `unlink_sim_${hashSuffix(seed)}`;

const buildSimulatedTxHash = (prefix, idempotencyKey) => `0x${hashSuffix(`${prefix}:${idempotencyKey}`).padEnd(64, "0")}`;

const buildMutationFailure = ({ environment, code, message }) => ({
  provider: DEFAULT_PROVIDER,
  environment: environment || null,
  txId: null,
  txHash: null,
  status: "failed",
  errorCode: code,
  errorMessage: message,
  raw: {}
});

const parseProviderAmount = (balances, token) => {
  if (!Array.isArray(balances)) {
    return null;
  }
  const normalizedToken = String(token || "").trim().toLowerCase();
  const matching =
    balances.find((entry) => {
      const address = String(entry?.token?.address || entry?.address || entry?.tokenAddress || "").trim().toLowerCase();
      const symbol = String(entry?.token?.symbol || entry?.symbol || "").trim().toLowerCase();
      if (normalizedToken && address) {
        return address === normalizedToken;
      }
      return symbol === "usdc";
    }) || balances[0];

  if (!matching) {
    return null;
  }

  const amountCandidates = [
    matching.amount,
    matching.balance,
    matching.value,
    matching?.amount?.value
  ];
  const raw = amountCandidates.find((value) => value !== undefined && value !== null);
  if (raw === undefined || raw === null) {
    return null;
  }
  const text = String(raw).trim();
  if (!/^[0-9]+$/.test(text)) {
    return null;
  }
  return text;
};

const buildFallbackResult = ({ environment, network, snapshot, reason }) => ({
  provider: DEFAULT_PROVIDER,
  environment,
  network,
  amount: snapshot?.amount || "0",
  freshness: snapshot ? "cached" : "degraded",
  lastProviderSyncAt: snapshot?.sourceUpdatedAt || snapshot?.recordedAt || null,
  readStatus: snapshot ? "snapshot_fallback" : reason || "provider_unavailable"
});

export const privacyVaultService = {
  getEnvironmentForNetwork(network) {
    return resolveEnvironmentForNetwork(network);
  },

  async ensureOmnibusAccount({ environment, network }) {
    const normalizedEnvironment = String(environment || "").trim() || null;
    if (!normalizedEnvironment) {
      throw new Error("environment is required");
    }

    const existing = getPrivateAccount({
      merchantId: null,
      accountId: null,
      provider: DEFAULT_PROVIDER,
      environment: normalizedEnvironment,
      role: "omnibus"
    });
    if (existing) {
      return existing;
    }

    if (!simulationEnabled()) {
      throw new Error("unlink omnibus account creation is not configured");
    }

    return upsertPrivateAccount({
      merchantId: null,
      accountId: null,
      provider: DEFAULT_PROVIDER,
      environment: normalizedEnvironment,
      network: String(network || "").trim() || normalizedEnvironment,
      role: "omnibus",
      unlinkAddress: buildSimulatedUnlinkAddress(`omnibus:${normalizedEnvironment}`),
      keyReference: `simulated:omnibus:${normalizedEnvironment}`,
      status: "active"
    });
  },

  async getOrCreateMerchantAccount({ merchantId, accountId, environment, network }) {
    const normalizedEnvironment = String(environment || "").trim() || null;
    if (!merchantId || !accountId || !normalizedEnvironment) {
      throw new Error("merchantId, accountId, and environment are required");
    }

    const existing = getPrivateAccount({
      merchantId,
      accountId,
      provider: DEFAULT_PROVIDER,
      environment: normalizedEnvironment,
      role: "merchant"
    });
    if (existing) {
      return existing;
    }

    if (!simulationEnabled()) {
      throw new Error("unlink merchant account creation is not configured");
    }

    return upsertPrivateAccount({
      merchantId,
      accountId,
      provider: DEFAULT_PROVIDER,
      environment: normalizedEnvironment,
      network: String(network || "").trim() || normalizedEnvironment,
      role: "merchant",
      unlinkAddress: buildSimulatedUnlinkAddress(`merchant:${merchantId}:${accountId}:${normalizedEnvironment}`),
      keyReference: `simulated:merchant:${merchantId}:${accountId}:${normalizedEnvironment}`,
      status: "active"
    });
  },

  async depositFromIntake({ environment, amount, idempotencyKey }) {
    const normalizedEnvironment = String(environment || "").trim() || null;
    if (!normalizedEnvironment || !idempotencyKey) {
      throw new Error("environment and idempotencyKey are required");
    }

    if (simulationEnabled()) {
      return {
        provider: DEFAULT_PROVIDER,
        environment: normalizedEnvironment,
        txId: `sim_deposit_${hashSuffix(idempotencyKey)}`,
        txHash: buildSimulatedTxHash("deposit", idempotencyKey),
        status: "processed",
        errorCode: null,
        errorMessage: null,
        raw: {
          simulated: true,
          amount: String(amount || "0")
        }
      };
    }

    return buildMutationFailure({
      environment: normalizedEnvironment,
      code: "provider_write_not_configured",
      message: "Unlink deposit mutations are not configured yet"
    });
  },

  async transferPrivately({ environment, amount, idempotencyKey }) {
    const normalizedEnvironment = String(environment || "").trim() || null;
    if (!normalizedEnvironment || !idempotencyKey) {
      throw new Error("environment and idempotencyKey are required");
    }

    if (simulationEnabled()) {
      return {
        provider: DEFAULT_PROVIDER,
        environment: normalizedEnvironment,
        txId: `sim_transfer_${hashSuffix(idempotencyKey)}`,
        txHash: buildSimulatedTxHash("transfer", idempotencyKey),
        status: "processed",
        errorCode: null,
        errorMessage: null,
        raw: {
          simulated: true,
          amount: String(amount || "0")
        }
      };
    }

    return buildMutationFailure({
      environment: normalizedEnvironment,
      code: "provider_write_not_configured",
      message: "Unlink private transfers are not configured yet"
    });
  },

  async getPrivateBalance({ merchantId, accountId, network, token }) {
    const environment = resolveEnvironmentForNetwork(network);
    const snapshot = getLatestPrivateBalanceSnapshot({
      merchantId,
      accountId,
      network,
      asset: "USDC",
      provider: DEFAULT_PROVIDER
    });

    if (!environment || !config.unlinkEnabled || !config.unlinkApiKey || !config.unlinkEngineUrl) {
      return buildFallbackResult({
        environment,
        network,
        snapshot,
        reason: "unlink_not_configured"
      });
    }

    const privateAccount = getPrivateAccount({
      merchantId,
      accountId,
      provider: DEFAULT_PROVIDER,
      environment,
      role: "merchant"
    });
    if (!privateAccount?.unlinkAddress) {
      return buildFallbackResult({
        environment,
        network,
        snapshot,
        reason: "private_account_missing"
      });
    }

    const sdk = await loadUnlinkSdk();
    if (sdk.error) {
      return buildFallbackResult({
        environment,
        network,
        snapshot,
        reason: "sdk_unavailable"
      });
    }

    try {
      const createUnlinkClient = sdk.createUnlinkClient;
      const accountHelpers = sdk.account;
      if (typeof createUnlinkClient !== "function" || !accountHelpers) {
        return buildFallbackResult({
          environment,
          network,
          snapshot,
          reason: "sdk_shape_unsupported"
        });
      }

      const unlink = createUnlinkClient({
        engineUrl: config.unlinkEngineUrl,
        apiKey: config.unlinkApiKey,
        environment
      });

      const identity =
        typeof accountHelpers.fromPublicIdentity === "function"
          ? accountHelpers.fromPublicIdentity({ address: privateAccount.unlinkAddress })
          : null;
      if (!identity) {
        return buildFallbackResult({
          environment,
          network,
          snapshot,
          reason: "public_identity_unsupported"
        });
      }

      const me = unlink.user(identity);
      const result =
        token !== undefined && token !== null && String(token).trim() !== ""
          ? await me.getBalances({ token })
          : await me.getBalances();
      const amount = parseProviderAmount(result?.balances || result, token);
      if (!amount) {
        return buildFallbackResult({
          environment,
          network,
          snapshot,
          reason: "provider_balance_missing"
        });
      }

      const sourceUpdatedAt = new Date().toISOString();
      insertPrivateBalanceSnapshot({
        merchantId,
        accountId,
        provider: DEFAULT_PROVIDER,
        environment,
        network,
        asset: DEFAULT_TOKEN,
        amount,
        freshness: "live",
        sourceUpdatedAt
      });

      return {
        provider: DEFAULT_PROVIDER,
        environment,
        network,
        amount,
        freshness: "live",
        lastProviderSyncAt: sourceUpdatedAt,
        readStatus: "provider_live"
      };
    } catch (error) {
      return buildFallbackResult({
        environment,
        network,
        snapshot,
        reason: error instanceof Error ? error.message : "provider_read_failed"
      });
    }
  }
};
