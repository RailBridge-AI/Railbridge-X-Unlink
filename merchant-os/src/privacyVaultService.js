import { config } from "./config.js";
import {
  getLatestPrivateBalanceSnapshot,
  getPrivateAccount,
  insertPrivateBalanceSnapshot
} from "./db.js";

const DEFAULT_PROVIDER = "unlink";

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
  readStatus: reason || (snapshot ? "snapshot_fallback" : "provider_unavailable")
});

export const privacyVaultService = {
  getEnvironmentForNetwork(network) {
    return resolveEnvironmentForNetwork(network);
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
        asset: "USDC",
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
