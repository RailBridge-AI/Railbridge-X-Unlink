import { createHash } from "node:crypto";
import {
  createUnlink,
  createUnlinkClient,
  getTransaction,
  unlinkAccount,
  unlinkEvm
} from "@unlink-xyz/sdk";
import { wordlist } from "@scure/bip39/wordlists/english";
import { createPublicClient, createWalletClient, http } from "viem";
import { baseSepolia, sepolia } from "viem/chains";
import { generateMnemonic, privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";
import { decryptSecretValue, encryptSecretValue } from "./custodyKeyManager.js";
import {
  getLatestPrivateBalanceSnapshot,
  getPrivateAccount,
  insertPrivateBalanceSnapshot,
  upsertPrivateAccount
} from "./db.js";

const DEFAULT_PROVIDER = "unlink";
const DEFAULT_TOKEN = "USDC";
const ENCRYPTED_KEY_PREFIX = "enc:v1:";
const SUCCESS_STATUSES = new Set(["relayed", "processed"]);

const CHAIN_BY_NETWORK = {
  "eip155:84532": baseSepolia,
  "eip155:11155111": sepolia
};

const simulationEnabled = () => Boolean(config.allowSimulatedLedgerMutations);

const providerWritesConfigured = () =>
  Boolean(
    config.unlinkEnabled &&
      config.unlinkApiKey &&
      config.unlinkEngineUrl &&
      config.custodyMasterKey
  );

const resolveEnvironmentForNetwork = (network) => {
  const direct = config.unlinkEnvironmentByNetwork?.[network];
  if (direct) {
    return String(direct).trim();
  }
  return config.unlinkDefaultEnvironment || null;
};

const resolveNetworkForEnvironment = (environment) => {
  const normalizedEnvironment = String(environment || "").trim();
  const match = Object.entries(config.unlinkEnvironmentByNetwork || {}).find(
    ([, value]) => String(value).trim() === normalizedEnvironment
  );
  return match?.[0] || null;
};

const hashSuffix = (value) =>
  createHash("sha256")
    .update(String(value || ""))
    .digest("hex")
    .slice(0, 24);

const buildSimulatedUnlinkAddress = (seed) => `unlink_sim_${hashSuffix(seed)}`;

const buildSimulatedTxHash = (prefix, idempotencyKey) =>
  `0x${hashSuffix(`${prefix}:${idempotencyKey}`).padEnd(64, "0")}`;

const buildMutationFailure = ({ environment, code, message, raw = {} }) => ({
  provider: DEFAULT_PROVIDER,
  environment: environment || null,
  txId: null,
  txHash: null,
  status: "failed",
  errorCode: code,
  errorMessage: message,
  raw
});

const parseProviderAmount = (balances, token) => {
  if (!Array.isArray(balances)) {
    return null;
  }
  const normalizedToken = String(token || "").trim().toLowerCase();
  const matching =
    balances.find((entry) => {
      const address = String(entry?.token || entry?.token?.address || entry?.address || "")
        .trim()
        .toLowerCase();
      const symbol = String(entry?.token?.symbol || entry?.symbol || "")
        .trim()
        .toLowerCase();
      if (normalizedToken && address) {
        return address === normalizedToken;
      }
      return symbol === "usdc";
    }) || balances[0];

  if (!matching) {
    return null;
  }

  const amountCandidates = [matching.amount, matching.balance, matching.value, matching?.amount?.value];
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

const serializeEncryptedKeyReference = (encryptedRecord) =>
  `${ENCRYPTED_KEY_PREFIX}${Buffer.from(JSON.stringify(encryptedRecord), "utf8").toString("base64url")}`;

const parseEncryptedKeyReference = (keyReference) => {
  const text = String(keyReference || "").trim();
  if (!text.startsWith(ENCRYPTED_KEY_PREFIX)) {
    return null;
  }
  try {
    const payload = Buffer.from(text.slice(ENCRYPTED_KEY_PREFIX.length), "base64url").toString("utf8");
    return JSON.parse(payload);
  } catch {
    return null;
  }
};

const resolveUsdcTokenAddress = (network) => {
  const token = String(config.usdcTokenByNetwork?.[network] || "").trim();
  return token || null;
};

const resolveOmnibusMnemonic = (environment) => {
  const mnemonic = String(config.unlinkOmnibusMnemonicByEnvironment?.[environment] || "").trim();
  return mnemonic || null;
};

const resolveIntakePrivateKey = (environment) => {
  const privateKey = String(config.treasuryIntakePrivateKeyByEnvironment?.[environment] || "").trim();
  if (!privateKey) {
    return null;
  }
  const normalized = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  return /^0x[0-9a-fA-F]{64}$/.test(normalized) ? normalized : null;
};

const buildRpcTransport = (network) => {
  const rpcUrl = String(config.rpcByNetwork?.[network] || "").trim();
  if (!rpcUrl) {
    return null;
  }
  return http(rpcUrl);
};

const buildViemClients = (network, privateKey) => {
  const chain = CHAIN_BY_NETWORK[network];
  const transport = buildRpcTransport(network);
  if (!chain || !transport || !privateKey) {
    return null;
  }
  const account = privateKeyToAccount(privateKey);
  return {
    account,
    publicClient: createPublicClient({ chain, transport }),
    walletClient: createWalletClient({ account, chain, transport })
  };
};

const buildUnlinkAccountProvider = ({ role, keyReference, environment }) => {
  if (role === "omnibus") {
    const mnemonic = resolveOmnibusMnemonic(environment);
    if (!mnemonic) {
      throw new Error("omnibus mnemonic is not configured");
    }
    return unlinkAccount.fromMnemonic({ mnemonic });
  }

  const encryptedRecord = parseEncryptedKeyReference(keyReference);
  if (!encryptedRecord) {
    throw new Error("merchant unlink account secret is missing");
  }
  const mnemonic = decryptSecretValue(encryptedRecord, config.custodyMasterKey);
  return unlinkAccount.fromMnemonic({ mnemonic: String(mnemonic).trim() });
};

const buildUnlinkClient = async ({ role, keyReference, environment, evm }) => {
  const account = buildUnlinkAccountProvider({ role, keyReference, environment });
  const client = createUnlink({
    engineUrl: config.unlinkEngineUrl,
    apiKey: config.unlinkApiKey,
    account,
    ...(evm ? { evm } : {})
  });
  await client.ensureRegistered();
  return client;
};

const pollProviderTransaction = async (client, txId) => {
  const result = await client.pollTransactionStatus(txId, {
    intervalMs: config.unlinkMutationPollIntervalMs,
    timeoutMs: config.unlinkMutationPollTimeoutMs
  });
  const transaction = await getTransaction(client.client, txId);
  return {
    txId: result.txId,
    status: SUCCESS_STATUSES.has(String(result.status || "").toLowerCase()) ? "processed" : "failed",
    txHash: transaction?.tx_hash || null,
    providerStatus: result.status,
    raw: transaction || result
  };
};

const normalizeProviderMutationResult = async (client, result) => {
  const polled = await pollProviderTransaction(client, result.txId);
  return {
    txId: polled.txId,
    txHash: polled.txHash,
    status: polled.status,
    providerStatus: polled.providerStatus,
    raw: polled.raw
  };
};

const registerAndPersistOmnibusAccount = async ({ environment, network }) => {
  const mnemonic = resolveOmnibusMnemonic(environment);
  if (!mnemonic) {
    throw new Error("omnibus mnemonic is not configured");
  }

  const client = await buildUnlinkClient({
    role: "omnibus",
    keyReference: `env:omnibus:${environment}`,
    environment
  });
  const unlinkAddress = await client.getAddress();

  return upsertPrivateAccount({
    merchantId: null,
    accountId: null,
    provider: DEFAULT_PROVIDER,
    environment,
    network,
    role: "omnibus",
    unlinkAddress,
    keyReference: `env:omnibus:${environment}`,
    status: "active"
  });
};

const registerAndPersistMerchantAccount = async ({ merchantId, accountId, environment, network }) => {
  const mnemonic = generateMnemonic(wordlist);
  const encryptedRecord = encryptSecretValue(mnemonic, config.custodyMasterKey);
  const keyReference = serializeEncryptedKeyReference(encryptedRecord);

  const client = await buildUnlinkClient({
    role: "merchant",
    keyReference,
    environment
  });
  const unlinkAddress = await client.getAddress();

  return upsertPrivateAccount({
    merchantId,
    accountId,
    provider: DEFAULT_PROVIDER,
    environment,
    network,
    role: "merchant",
    unlinkAddress,
    keyReference,
    status: "active"
  });
};

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
    if (existing?.unlinkAddress) {
      return existing;
    }

    if (simulationEnabled()) {
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
    }

    if (!providerWritesConfigured()) {
      throw new Error("unlink provider writes are not configured");
    }

    return registerAndPersistOmnibusAccount({
      environment: normalizedEnvironment,
      network: String(network || "").trim() || resolveNetworkForEnvironment(normalizedEnvironment) || normalizedEnvironment
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
    if (existing?.unlinkAddress) {
      return existing;
    }

    if (simulationEnabled()) {
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
    }

    if (!providerWritesConfigured()) {
      throw new Error("unlink provider writes are not configured");
    }

    return registerAndPersistMerchantAccount({
      merchantId,
      accountId,
      environment: normalizedEnvironment,
      network: String(network || "").trim() || resolveNetworkForEnvironment(normalizedEnvironment) || normalizedEnvironment
    });
  },

  async depositFromIntake({
    environment,
    network,
    amount,
    idempotencyKey,
    omnibusAccountRef
  }) {
    const normalizedEnvironment = String(environment || "").trim() || null;
    const normalizedNetwork =
      String(network || "").trim() || resolveNetworkForEnvironment(normalizedEnvironment) || null;
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

    if (!providerWritesConfigured()) {
      return buildMutationFailure({
        environment: normalizedEnvironment,
        code: "provider_write_not_configured",
        message: "Unlink provider writes are not configured"
      });
    }

    const intakePrivateKey = resolveIntakePrivateKey(normalizedEnvironment);
    const token = resolveUsdcTokenAddress(normalizedNetwork);
    const viemClients = buildViemClients(normalizedNetwork, intakePrivateKey);
    const omnibusAccount =
      omnibusAccountRef ||
      (await this.ensureOmnibusAccount({
        environment: normalizedEnvironment,
        network: normalizedNetwork
      }));

    if (!intakePrivateKey) {
      return buildMutationFailure({
        environment: normalizedEnvironment,
        code: "intake_wallet_missing",
        message: "Treasury intake private key is not configured for this environment"
      });
    }
    if (!token) {
      return buildMutationFailure({
        environment: normalizedEnvironment,
        code: "usdc_token_missing",
        message: "USDC token address is not configured for this network"
      });
    }
    if (!viemClients) {
      return buildMutationFailure({
        environment: normalizedEnvironment,
        code: "rpc_missing",
        message: "RPC transport is not configured for this network"
      });
    }
    if (!omnibusAccount?.unlinkAddress) {
      return buildMutationFailure({
        environment: normalizedEnvironment,
        code: "omnibus_account_missing",
        message: "Omnibus Unlink account is not available"
      });
    }

    try {
      const evm = unlinkEvm.fromViem({
        walletClient: viemClients.walletClient,
        publicClient: viemClients.publicClient
      });
      const client = await buildUnlinkClient({
        role: "omnibus",
        keyReference: omnibusAccount.keyReference,
        environment: normalizedEnvironment,
        evm
      });

      const approval = await client.ensureErc20Approval({
        token,
        amount: String(amount || "0"),
        evm
      });
      if (approval.status === "submitted" && approval.txHash) {
        await viemClients.publicClient.waitForTransactionReceipt({
          hash: approval.txHash
        });
      }

      const submitted = await client.deposit({
        token,
        amount: String(amount || "0"),
        evm
      });
      const finalized = await normalizeProviderMutationResult(client, submitted);

      return {
        provider: DEFAULT_PROVIDER,
        environment: normalizedEnvironment,
        txId: finalized.txId,
        txHash: finalized.txHash,
        status: finalized.status,
        errorCode: finalized.status === "processed" ? null : "deposit_not_processed",
        errorMessage:
          finalized.status === "processed"
            ? null
            : `Deposit finished in status ${finalized.providerStatus || "unknown"}`,
        raw: finalized.raw
      };
    } catch (error) {
      return buildMutationFailure({
        environment: normalizedEnvironment,
        code: "deposit_failed",
        message: error instanceof Error ? error.message : String(error),
        raw: {
          idempotencyKey
        }
      });
    }
  },

  async transferPrivately({
    environment,
    network,
    amount,
    idempotencyKey,
    fromAccountRef,
    toUnlinkAddress
  }) {
    const normalizedEnvironment = String(environment || "").trim() || null;
    const normalizedNetwork =
      String(network || "").trim() || resolveNetworkForEnvironment(normalizedEnvironment) || null;
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

    if (!providerWritesConfigured()) {
      return buildMutationFailure({
        environment: normalizedEnvironment,
        code: "provider_write_not_configured",
        message: "Unlink provider writes are not configured"
      });
    }

    const omnibusAccount =
      fromAccountRef ||
      (await this.ensureOmnibusAccount({
        environment: normalizedEnvironment,
        network: normalizedNetwork
      }));
    const token = resolveUsdcTokenAddress(normalizedNetwork);
    const recipientAddress = String(toUnlinkAddress || "").trim();

    if (!omnibusAccount?.keyReference) {
      return buildMutationFailure({
        environment: normalizedEnvironment,
        code: "omnibus_account_missing",
        message: "Omnibus Unlink account is not available"
      });
    }
    if (!recipientAddress) {
      return buildMutationFailure({
        environment: normalizedEnvironment,
        code: "recipient_missing",
        message: "Merchant Unlink address is required"
      });
    }
    if (!token) {
      return buildMutationFailure({
        environment: normalizedEnvironment,
        code: "usdc_token_missing",
        message: "USDC token address is not configured for this network"
      });
    }

    try {
      const client = await buildUnlinkClient({
        role: "omnibus",
        keyReference: omnibusAccount.keyReference,
        environment: normalizedEnvironment
      });
      const submitted = await client.transfer({
        token,
        recipientAddress,
        amount: String(amount || "0")
      });
      const finalized = await normalizeProviderMutationResult(client, submitted);

      return {
        provider: DEFAULT_PROVIDER,
        environment: normalizedEnvironment,
        txId: finalized.txId,
        txHash: finalized.txHash,
        status: finalized.status,
        errorCode: finalized.status === "processed" ? null : "transfer_not_processed",
        errorMessage:
          finalized.status === "processed"
            ? null
            : `Transfer finished in status ${finalized.providerStatus || "unknown"}`,
        raw: finalized.raw
      };
    } catch (error) {
      return buildMutationFailure({
        environment: normalizedEnvironment,
        code: "transfer_failed",
        message: error instanceof Error ? error.message : String(error),
        raw: {
          idempotencyKey,
          recipientAddress
        }
      });
    }
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

    try {
      const usdcToken = resolveUsdcTokenAddress(network);
      let amount = null;

      if (simulationEnabled() || !privateAccount.keyReference?.startsWith(ENCRYPTED_KEY_PREFIX)) {
        const apiClient = createUnlinkClient(config.unlinkEngineUrl, config.unlinkApiKey);
        const response = await apiClient.GET("/users/{address}/balances", {
          params: {
            path: { address: privateAccount.unlinkAddress },
            query: usdcToken ? { token: usdcToken } : {}
          }
        });
        if (response.error) {
          throw new Error("provider balance read failed");
        }
        amount = parseProviderAmount(response.data?.data?.balances, usdcToken);
      } else {
        const client = await buildUnlinkClient({
          role: "merchant",
          keyReference: privateAccount.keyReference,
          environment
        });
        const balances = await client.getBalances(usdcToken ? { token: usdcToken } : {});
        amount = parseProviderAmount(balances?.balances, usdcToken);
      }

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
