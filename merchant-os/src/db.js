import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";
import {
  decryptCustodyPrivateKey,
  encryptCustodyPrivateKey,
  generateCustodyWallet,
  isValidCustodyMasterKey
} from "./custodyKeyManager.js";
import { addHoursIso, newId, nowIso, statusPrecedence, toDecimalUsdcString } from "./utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const schemaPath = join(__dirname, "schema.sql");

const TESTNET_CAIP2 = [
  "eip155:421614",
  "eip155:5042002",
  "eip155:43113",
  "eip155:84532",
  "eip155:11155111",
  "eip155:998",
  "eip155:763373",
  "eip155:59141",
  "eip155:10143",
  "eip155:11155420",
  "eip155:98867",
  "eip155:80002",
  "eip155:1328",
  "eip155:14601",
  "eip155:1301",
  "eip155:4801"
];

const DEFAULT_USDC_ASSET = "0x3600000000000000000000000000000000000000";

const USDC_ASSET_BY_NETWORK = {
  "eip155:421614": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", // Arbitrum Sepolia
  "eip155:5042002": "0x3600000000000000000000000000000000000000", // Arc Testnet
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia
  "eip155:11155111": "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238" // Ethereum Sepolia
};

const resolveUsdcAssetForNetwork = (network) => USDC_ASSET_BY_NETWORK[network] || DEFAULT_USDC_ASSET;
const resolveDemoSourceNetwork = () =>
  TESTNET_CAIP2.includes(config.demoSourceNetwork) ? config.demoSourceNetwork : "eip155:421614";

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

const demoWalletAddress = (prefix36, network) => {
  const chainId = network.replace(/^eip155:/, "");
  const suffix = ("0000" + Number(chainId).toString(16)).slice(-4);
  return `0x${prefix36}${suffix}`;
};

const sharedCustodyPrivateKey = normalizePrivateKey(config.bridgePrivateKey);
const sharedCustodyAddress =
  normalizeEvmAddress(config.custodyAddress) ||
  (sharedCustodyPrivateKey ? privateKeyToAccount(sharedCustodyPrivateKey).address : null);

const demoWalletsFor = (prefix, keyPrefix) =>
  TESTNET_CAIP2.map((network) => ({
    network,
    asset: "USDC",
    address: sharedCustodyAddress || demoWalletAddress(prefix, network),
    keyReference: `custody:${keyPrefix}:${network}`
  }));

const DEMO_MERCHANTS = [
  {
    merchantId: "11111111-1111-4111-8111-111111111111",
    merchantName: "Alpha Commerce",
    accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    accountName: "Alpha Treasury",
    userId: "10000000-0000-4000-8000-000000000001",
    email: "ops+alpha@railbridge.demo",
    password: "demo123",
    role: "admin",
    wallets: demoWalletsFor("111111111111111111111111111111111111", "alpha"),
    defaultPolicyNetwork: "eip155:84532"
  },
  {
    merchantId: "22222222-2222-4222-8222-222222222222",
    merchantName: "Beta Goods",
    accountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    accountName: "Beta Treasury",
    userId: "20000000-0000-4000-8000-000000000002",
    email: "ops+beta@railbridge.demo",
    password: "demo123",
    role: "admin",
    wallets: demoWalletsFor("222222222222222222222222222222222222", "beta"),
    defaultPolicyNetwork: "eip155:11155111"
  }
];

const sqlLiteral = (value) => {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }
  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }
  return `'${String(value).replace(/'/g, "''")}'`;
};

const sqlite = (args) =>
  execFileSync("sqlite3", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

const run = (sql) => {
  sqlite([config.dbPath, sql]);
};

const all = (sql) => {
  const output = sqlite(["-json", config.dbPath, sql]).trim();
  if (!output) {
    return [];
  }
  return JSON.parse(output);
};

const one = (sql) => {
  const rows = all(sql);
  return rows[0] || null;
};

const ensureColumn = (tableName, columnName, columnType) => {
  const columns = all(`PRAGMA table_info(${tableName});`);
  const hasColumn = columns.some((column) => column.name === columnName);
  if (!hasColumn) {
    run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType};`);
  }
};

const runSchemaMigrations = () => {
  ensureColumn("treasury_settlement_events", "api_id", "TEXT");
  ensureColumn("treasury_settlement_events", "api_route", "TEXT");
  ensureColumn("treasury_settlement_events", "api_name", "TEXT");
  ensureColumn("treasury_settlement_events", "source_tx_hash", "TEXT");
  ensureColumn("treasury_settlement_events", "bridge_tx_hash", "TEXT");
  ensureColumn("treasury_settlement_events", "destination_tx_hash", "TEXT");
  ensureColumn("treasury_settlement_events", "block_number", "INTEGER");
  ensureColumn("treasury_settlement_events", "log_index", "INTEGER");
  ensureColumn("treasury_settlement_events", "confirmations", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("treasury_consolidations", "tx_hash", "TEXT");
  ensureColumn("treasury_consolidations", "source_tx_hash", "TEXT");
  ensureColumn("treasury_consolidations", "bridge_tx_hash", "TEXT");
  ensureColumn("treasury_consolidations", "destination_tx_hash", "TEXT");
  run(`
    CREATE INDEX IF NOT EXISTS idx_settlement_source_tx
      ON treasury_settlement_events(source_network, source_tx_hash, log_index);
  `);
};

const ensureDbDirectory = () => {
  const dbDir = dirname(config.dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }
};

const alignDemoApiProductSourceNetwork = () => {
  const sourceNetwork = resolveDemoSourceNetwork();
  const sourceAsset = resolveUsdcAssetForNetwork(sourceNetwork);
  run(`
    UPDATE api_products
    SET
      source_network = ${sqlLiteral(sourceNetwork)},
      source_asset = ${sqlLiteral(sourceAsset)},
      updated_at = ${sqlLiteral(nowIso())}
    WHERE api_id = 'premium_api'
      AND path = '/api/premium';
  `);
};

const assertCustodyMasterKeyConfigured = () => {
  if (!isValidCustodyMasterKey(config.custodyMasterKey)) {
    throw new Error(
      "MERCHANT_OS_CUSTODY_MASTER_KEY is required and must be a 32-byte hex string (64 hex chars, optional 0x prefix)"
    );
  }
};

const mapCustodyKeyRow = (row) => {
  if (!row) {
    return null;
  }
  return {
    keyReference: row.keyReference,
    merchantId: row.merchantId,
    accountId: row.accountId,
    address: row.address,
    encryptedPrivateKey: row.encryptedPrivateKey,
    iv: row.iv,
    authTag: row.authTag,
    algorithm: row.algorithm,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
};

const getCustodyKeyRecord = (merchantId, accountId, keyReference) =>
  mapCustodyKeyRow(
    one(`
      SELECT
        key_reference AS keyReference,
        merchant_id AS merchantId,
        account_id AS accountId,
        address,
        encrypted_private_key AS encryptedPrivateKey,
        iv,
        auth_tag AS authTag,
        algorithm,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM custody_keys
      WHERE merchant_id = ${sqlLiteral(merchantId)}
        AND account_id = ${sqlLiteral(accountId)}
        AND key_reference = ${sqlLiteral(keyReference)}
      LIMIT 1;
    `)
  );

const getFirstCustodyKeyRecordForTenant = (merchantId, accountId) =>
  mapCustodyKeyRow(
    one(`
      SELECT
        key_reference AS keyReference,
        merchant_id AS merchantId,
        account_id AS accountId,
        address,
        encrypted_private_key AS encryptedPrivateKey,
        iv,
        auth_tag AS authTag,
        algorithm,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM custody_keys
      WHERE merchant_id = ${sqlLiteral(merchantId)}
        AND account_id = ${sqlLiteral(accountId)}
      ORDER BY created_at ASC
      LIMIT 1;
    `)
  );

const updateWalletAddressByReference = (merchantId, accountId, keyReference, address) => {
  run(`
    UPDATE merchant_account_wallets
    SET address = ${sqlLiteral(address)}
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
      AND key_reference = ${sqlLiteral(keyReference)};
  `);
};

const tenantSeedPrivateKeyCache = new Map();

const resolveSeedPrivateKeyForTenant = (merchantId, accountId) => {
  const cacheKey = `${merchantId}:${accountId}`;
  const cached = tenantSeedPrivateKeyCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const existing = getFirstCustodyKeyRecordForTenant(merchantId, accountId);
  if (existing) {
    const existingPrivateKey = decryptCustodyPrivateKey(existing, config.custodyMasterKey);
    tenantSeedPrivateKeyCache.set(cacheKey, existingPrivateKey);
    return existingPrivateKey;
  }

  if (sharedCustodyPrivateKey) {
    tenantSeedPrivateKeyCache.set(cacheKey, sharedCustodyPrivateKey);
    return sharedCustodyPrivateKey;
  }

  const generated = generateCustodyWallet();
  tenantSeedPrivateKeyCache.set(cacheKey, generated.privateKey);
  return generated.privateKey;
};

const ensureCustodyKeyForWallet = (wallet) => {
  const existing = getCustodyKeyRecord(wallet.merchantId, wallet.accountId, wallet.keyReference);
  if (existing) {
    const walletAddress = normalizeEvmAddress(wallet.address);
    const custodyAddress = normalizeEvmAddress(existing.address);
    if (custodyAddress && walletAddress !== custodyAddress) {
      updateWalletAddressByReference(wallet.merchantId, wallet.accountId, wallet.keyReference, existing.address);
    }
    return existing;
  }

  const seedPrivateKey = resolveSeedPrivateKeyForTenant(wallet.merchantId, wallet.accountId);
  const seedAccount = privateKeyToAccount(seedPrivateKey);
  const timestamp = nowIso();
  const encrypted = encryptCustodyPrivateKey(seedPrivateKey, config.custodyMasterKey);

  run(`
    INSERT INTO custody_keys (
      key_reference,
      merchant_id,
      account_id,
      address,
      encrypted_private_key,
      iv,
      auth_tag,
      algorithm,
      created_at,
      updated_at
    ) VALUES (
      ${sqlLiteral(wallet.keyReference)},
      ${sqlLiteral(wallet.merchantId)},
      ${sqlLiteral(wallet.accountId)},
      ${sqlLiteral(seedAccount.address)},
      ${sqlLiteral(encrypted.encryptedPrivateKey)},
      ${sqlLiteral(encrypted.iv)},
      ${sqlLiteral(encrypted.authTag)},
      ${sqlLiteral(encrypted.algorithm)},
      ${sqlLiteral(timestamp)},
      ${sqlLiteral(timestamp)}
    );
  `);

  updateWalletAddressByReference(wallet.merchantId, wallet.accountId, wallet.keyReference, seedAccount.address);
  return getCustodyKeyRecord(wallet.merchantId, wallet.accountId, wallet.keyReference);
};

const backfillCustodyKeysForWallets = () => {
  const wallets = all(`
    SELECT
      merchant_id AS merchantId,
      account_id AS accountId,
      key_reference AS keyReference,
      address
    FROM merchant_account_wallets
    WHERE asset = 'USDC'
    ORDER BY merchant_id ASC, account_id ASC, network ASC;
  `);

  wallets.forEach((wallet) => {
    ensureCustodyKeyForWallet(wallet);
  });
};

export const initializeDatabase = () => {
  assertCustodyMasterKeyConfigured();
  tenantSeedPrivateKeyCache.clear();
  ensureDbDirectory();
  run("PRAGMA journal_mode = WAL;");
  run("PRAGMA foreign_keys = ON;");
  run(readFileSync(schemaPath, "utf8"));
  runSchemaMigrations();

  const merchantCount = one("SELECT COUNT(*) AS count FROM merchants;");
  if (!merchantCount || Number(merchantCount.count) === 0) {
    seedDemoData();
  }

  backfillCustodyKeysForWallets();

  // Keep demo premium API aligned with configured source network (defaults to Arbitrum Sepolia).
  alignDemoApiProductSourceNetwork();
};

export const resetDatabase = () => {
  if (existsSync(config.dbPath)) {
    rmSync(config.dbPath);
  }
  initializeDatabase();
};

export const seedDemoData = () => {
  const now = nowIso();

  DEMO_MERCHANTS.forEach((merchant) => {
    run(`
      INSERT OR IGNORE INTO merchants (id, name, created_at)
      VALUES (${sqlLiteral(merchant.merchantId)}, ${sqlLiteral(merchant.merchantName)}, ${sqlLiteral(now)});
    `);

    run(`
      INSERT OR IGNORE INTO merchant_accounts (id, merchant_id, account_name, custody_mode, created_at)
      VALUES (
        ${sqlLiteral(merchant.accountId)},
        ${sqlLiteral(merchant.merchantId)},
        ${sqlLiteral(merchant.accountName)},
        'custodial',
        ${sqlLiteral(now)}
      );
    `);

    run(`
      INSERT OR IGNORE INTO merchant_users (id, merchant_id, email, password_hash, role, created_at)
      VALUES (
        ${sqlLiteral(merchant.userId)},
        ${sqlLiteral(merchant.merchantId)},
        ${sqlLiteral(merchant.email)},
        ${sqlLiteral(merchant.password)},
        ${sqlLiteral(merchant.role)},
        ${sqlLiteral(now)}
      );
    `);

    merchant.wallets.forEach((wallet) => {
      run(`
        INSERT OR IGNORE INTO merchant_account_wallets (
          id, merchant_id, account_id, network, asset, address, key_reference, created_at
        ) VALUES (
          ${sqlLiteral(randomUUID())},
          ${sqlLiteral(merchant.merchantId)},
          ${sqlLiteral(merchant.accountId)},
          ${sqlLiteral(wallet.network)},
          ${sqlLiteral(wallet.asset)},
          ${sqlLiteral(wallet.address)},
          ${sqlLiteral(wallet.keyReference)},
          ${sqlLiteral(now)}
        );
      `);
    });

    run(`
      INSERT OR REPLACE INTO treasury_policy (
        merchant_id, account_id, preferred_network, preferred_asset, auto_bridge_enabled, updated_at
      ) VALUES (
        ${sqlLiteral(merchant.merchantId)},
        ${sqlLiteral(merchant.accountId)},
        ${sqlLiteral(merchant.defaultPolicyNetwork)},
        'USDC',
        1,
        ${sqlLiteral(now)}
      );
    `);

    const sourceNetwork = resolveDemoSourceNetwork();
    const sourceAsset = resolveUsdcAssetForNetwork(sourceNetwork);
    const destinationNetwork = merchant.defaultPolicyNetwork;
    const destinationAsset = resolveUsdcAssetForNetwork(destinationNetwork);
    const settlementMode = sourceNetwork === destinationNetwork ? "same_chain" : "cross_chain";

    run(`
      INSERT OR IGNORE INTO api_products (
        id,
        merchant_id,
        account_id,
        api_id,
        api_name,
        description,
        method,
        path,
        source_network,
        source_asset,
        amount,
        settlement_mode,
        destination_network,
        destination_asset,
        enabled,
        created_at,
        updated_at
      ) VALUES (
        ${sqlLiteral(randomUUID())},
        ${sqlLiteral(merchant.merchantId)},
        ${sqlLiteral(merchant.accountId)},
        'premium_api',
        'Premium API',
        'Default paid endpoint for Merchant OS demo',
        'GET',
        '/api/premium',
        ${sqlLiteral(sourceNetwork)},
        ${sqlLiteral(sourceAsset)},
        '10000',
        ${sqlLiteral(settlementMode)},
        ${sqlLiteral(destinationNetwork)},
        ${sqlLiteral(destinationAsset)},
        1,
        ${sqlLiteral(now)},
        ${sqlLiteral(now)}
      );
    `);
  });

  backfillCustodyKeysForWallets();
};

export const getDemoMerchants = () =>
  DEMO_MERCHANTS.map((merchant) => ({
    merchantId: merchant.merchantId,
    accountId: merchant.accountId,
    merchantName: merchant.merchantName,
    email: merchant.email,
    password: merchant.password
  }));

export const authenticateUser = (email, password) =>
  one(`
    SELECT
      u.id,
      u.merchant_id AS merchantId,
      a.id AS accountId,
      u.email,
      u.role
    FROM merchant_users u
    JOIN merchant_accounts a ON a.merchant_id = u.merchant_id
    WHERE u.email = ${sqlLiteral(email)}
      AND u.password_hash = ${sqlLiteral(password)}
    LIMIT 1;
  `);

export const createSession = ({ userId, merchantId, accountId, role }) => {
  const token = `demo_${newId().replace(/-/g, "")}`;
  const createdAt = nowIso();
  const expiresAt = addHoursIso(config.sessionHours);

  run(`
    INSERT INTO auth_sessions (
      token, user_id, merchant_id, account_id, role, created_at, expires_at
    ) VALUES (
      ${sqlLiteral(token)},
      ${sqlLiteral(userId)},
      ${sqlLiteral(merchantId)},
      ${sqlLiteral(accountId)},
      ${sqlLiteral(role)},
      ${sqlLiteral(createdAt)},
      ${sqlLiteral(expiresAt)}
    );
  `);

  return {
    token,
    createdAt,
    expiresAt
  };
};

export const getSession = (token) => {
  if (!token) {
    return null;
  }

  const session = one(`
    SELECT
      token,
      user_id AS userId,
      merchant_id AS merchantId,
      account_id AS accountId,
      role,
      created_at AS createdAt,
      expires_at AS expiresAt
    FROM auth_sessions
    WHERE token = ${sqlLiteral(token)}
    LIMIT 1;
  `);

  if (!session) {
    return null;
  }

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    run(`DELETE FROM auth_sessions WHERE token = ${sqlLiteral(token)};`);
    return null;
  }

  return session;
};

export const getWallets = (merchantId, accountId) =>
  all(`
    SELECT network, asset, address, key_reference AS keyReference
    FROM merchant_account_wallets
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
    ORDER BY network ASC;
  `);

export const getWalletByNetwork = (merchantId, accountId, network) =>
  one(`
    SELECT network, asset, address, key_reference AS keyReference
    FROM merchant_account_wallets
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
      AND network = ${sqlLiteral(network)}
      AND asset = 'USDC'
    LIMIT 1;
  `);

export const getCustodyKeyByReference = (merchantId, accountId, keyReference) => {
  const row = getCustodyKeyRecord(merchantId, accountId, keyReference);
  if (!row) {
    return null;
  }
  return {
    keyReference: row.keyReference,
    merchantId: row.merchantId,
    accountId: row.accountId,
    address: row.address,
    algorithm: row.algorithm,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
};

export const getCustodyPrivateKeyByReference = (merchantId, accountId, keyReference) => {
  const row = getCustodyKeyRecord(merchantId, accountId, keyReference);
  if (!row) {
    return null;
  }
  return decryptCustodyPrivateKey(row, config.custodyMasterKey);
};

const normalizeHttpMethod = (method) => String(method || "GET").trim().toUpperCase();

const mapApiProductRow = (row) => ({
  ...row,
  enabled: Boolean(row.enabled)
});

export const listApiProducts = (merchantId, accountId) =>
  all(`
    SELECT
      id,
      merchant_id AS merchantId,
      account_id AS accountId,
      api_id AS apiId,
      api_name AS apiName,
      description,
      method,
      path,
      source_network AS sourceNetwork,
      source_asset AS sourceAsset,
      amount,
      settlement_mode AS settlementMode,
      destination_network AS destinationNetwork,
      destination_asset AS destinationAsset,
      enabled,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM api_products
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
    ORDER BY method ASC, path ASC;
  `).map(mapApiProductRow);

export const getApiProductById = (merchantId, accountId, apiProductId) => {
  const row = one(`
    SELECT
      id,
      merchant_id AS merchantId,
      account_id AS accountId,
      api_id AS apiId,
      api_name AS apiName,
      description,
      method,
      path,
      source_network AS sourceNetwork,
      source_asset AS sourceAsset,
      amount,
      settlement_mode AS settlementMode,
      destination_network AS destinationNetwork,
      destination_asset AS destinationAsset,
      enabled,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM api_products
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
      AND id = ${sqlLiteral(apiProductId)}
    LIMIT 1;
  `);
  return row ? mapApiProductRow(row) : null;
};

export const getApiProductByMethodPath = (merchantId, accountId, method, path) => {
  const row = one(`
    SELECT
      id,
      merchant_id AS merchantId,
      account_id AS accountId,
      api_id AS apiId,
      api_name AS apiName,
      description,
      method,
      path,
      source_network AS sourceNetwork,
      source_asset AS sourceAsset,
      amount,
      settlement_mode AS settlementMode,
      destination_network AS destinationNetwork,
      destination_asset AS destinationAsset,
      enabled,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM api_products
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
      AND method = ${sqlLiteral(normalizeHttpMethod(method))}
      AND path = ${sqlLiteral(path)}
    LIMIT 1;
  `);
  return row ? mapApiProductRow(row) : null;
};

export const createApiProduct = (input) => {
  const now = nowIso();
  const id = newId();
  run(`
    INSERT INTO api_products (
      id,
      merchant_id,
      account_id,
      api_id,
      api_name,
      description,
      method,
      path,
      source_network,
      source_asset,
      amount,
      settlement_mode,
      destination_network,
      destination_asset,
      enabled,
      created_at,
      updated_at
    ) VALUES (
      ${sqlLiteral(id)},
      ${sqlLiteral(input.merchantId)},
      ${sqlLiteral(input.accountId)},
      ${sqlLiteral(input.apiId)},
      ${sqlLiteral(input.apiName)},
      ${sqlLiteral(input.description || null)},
      ${sqlLiteral(normalizeHttpMethod(input.method))},
      ${sqlLiteral(input.path)},
      ${sqlLiteral(input.sourceNetwork)},
      ${sqlLiteral(input.sourceAsset || resolveUsdcAssetForNetwork(input.sourceNetwork))},
      ${sqlLiteral(input.amount)},
      ${sqlLiteral(input.settlementMode)},
      ${sqlLiteral(input.destinationNetwork || null)},
      ${sqlLiteral(input.destinationAsset || null)},
      ${input.enabled === false ? 0 : 1},
      ${sqlLiteral(now)},
      ${sqlLiteral(now)}
    );
  `);
  return getApiProductById(input.merchantId, input.accountId, id);
};

export const updateApiProduct = (merchantId, accountId, apiProductId, patch) => {
  const existing = getApiProductById(merchantId, accountId, apiProductId);
  if (!existing) {
    return null;
  }

  const sourceNetwork = patch.sourceNetwork || existing.sourceNetwork;
  const destinationNetwork =
    patch.destinationNetwork !== undefined ? patch.destinationNetwork : existing.destinationNetwork;
  const settlementMode = patch.settlementMode || existing.settlementMode;
  const now = nowIso();
  const sourceNetworkChanged =
    patch.sourceNetwork !== undefined && patch.sourceNetwork !== existing.sourceNetwork;
  const destinationNetworkChanged =
    patch.destinationNetwork !== undefined && patch.destinationNetwork !== existing.destinationNetwork;

  const nextSourceAsset =
    patch.sourceAsset !== undefined
      ? patch.sourceAsset
      : sourceNetworkChanged
        ? resolveUsdcAssetForNetwork(sourceNetwork)
        : existing.sourceAsset || resolveUsdcAssetForNetwork(sourceNetwork);

  const nextDestinationAsset =
    patch.destinationAsset !== undefined
      ? patch.destinationAsset
      : destinationNetwork
        ? destinationNetworkChanged
          ? resolveUsdcAssetForNetwork(destinationNetwork)
          : existing.destinationAsset || resolveUsdcAssetForNetwork(destinationNetwork)
        : null;

  run(`
    UPDATE api_products
    SET
      api_id = ${sqlLiteral(patch.apiId || existing.apiId)},
      api_name = ${sqlLiteral(patch.apiName || existing.apiName)},
      description = ${sqlLiteral(patch.description !== undefined ? patch.description : existing.description)},
      method = ${sqlLiteral(normalizeHttpMethod(patch.method || existing.method))},
      path = ${sqlLiteral(patch.path || existing.path)},
      source_network = ${sqlLiteral(sourceNetwork)},
      source_asset = ${sqlLiteral(nextSourceAsset)},
      amount = ${sqlLiteral(patch.amount || existing.amount)},
      settlement_mode = ${sqlLiteral(settlementMode)},
      destination_network = ${sqlLiteral(destinationNetwork || null)},
      destination_asset = ${sqlLiteral(nextDestinationAsset)},
      enabled = ${
        patch.enabled === undefined
          ? existing.enabled
            ? 1
            : 0
          : patch.enabled
            ? 1
            : 0
      },
      updated_at = ${sqlLiteral(now)}
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
      AND id = ${sqlLiteral(apiProductId)};
  `);

  return getApiProductById(merchantId, accountId, apiProductId);
};

export const getPolicy = (merchantId, accountId) => {
  const row = one(`
    SELECT
      preferred_network AS preferredNetwork,
      preferred_asset AS preferredAsset,
      auto_bridge_enabled AS autoBridgeEnabled,
      updated_at AS updatedAt
    FROM treasury_policy
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
    LIMIT 1;
  `);

  if (!row) {
    return null;
  }

  return {
    ...row,
    autoBridgeEnabled: Boolean(row.autoBridgeEnabled)
  };
};

export const upsertPolicy = (merchantId, accountId, policy) => {
  const updatedAt = nowIso();
  run(`
    INSERT OR REPLACE INTO treasury_policy (
      merchant_id,
      account_id,
      preferred_network,
      preferred_asset,
      auto_bridge_enabled,
      updated_at
    ) VALUES (
      ${sqlLiteral(merchantId)},
      ${sqlLiteral(accountId)},
      ${sqlLiteral(policy.preferredNetwork)},
      'USDC',
      ${policy.autoBridgeEnabled ? 1 : 0},
      ${sqlLiteral(updatedAt)}
    );
  `);
  return getPolicy(merchantId, accountId);
};

export const hasSettlementEvent = (eventId) =>
  Boolean(
    one(`
      SELECT 1 AS exists_flag
      FROM treasury_settlement_events
      WHERE event_id = ${sqlLiteral(eventId)}
      LIMIT 1;
    `)
  );

export const hasSettlementLifecycleEvent = (merchantId, accountId, settlementId, status) =>
  Boolean(
    one(`
      SELECT 1 AS exists_flag
      FROM treasury_settlement_events
      WHERE merchant_id = ${sqlLiteral(merchantId)}
        AND account_id = ${sqlLiteral(accountId)}
        AND settlement_id = ${sqlLiteral(settlementId)}
        AND status = ${sqlLiteral(status)}
      LIMIT 1;
    `)
  );

export const insertSettlementEvent = (event) => {
  run(`
    INSERT OR IGNORE INTO treasury_settlement_events (
      event_id,
      settlement_id,
      merchant_id,
      account_id,
      api_id,
      api_route,
      api_name,
      source_network,
      destination_network,
      asset,
      amount,
      status,
      tx_hash,
      source_tx_hash,
      bridge_tx_hash,
      destination_tx_hash,
      block_number,
      log_index,
      confirmations,
      created_at
    ) VALUES (
      ${sqlLiteral(event.eventId)},
      ${sqlLiteral(event.settlementId)},
      ${sqlLiteral(event.merchantId)},
      ${sqlLiteral(event.accountId)},
      ${sqlLiteral(event.apiId || null)},
      ${sqlLiteral(event.apiRoute || null)},
      ${sqlLiteral(event.apiName || null)},
      ${sqlLiteral(event.sourceNetwork)},
      ${sqlLiteral(event.destinationNetwork)},
      'USDC',
      ${sqlLiteral(event.amount)},
      ${sqlLiteral(event.status)},
      ${sqlLiteral(event.txHash)},
      ${sqlLiteral(event.sourceTxHash || null)},
      ${sqlLiteral(event.bridgeTxHash || null)},
      ${sqlLiteral(event.destinationTxHash || null)},
      ${event.blockNumber === undefined || event.blockNumber === null ? "NULL" : sqlLiteral(event.blockNumber)},
      ${event.logIndex === undefined || event.logIndex === null ? "NULL" : sqlLiteral(event.logIndex)},
      ${event.confirmations === undefined || event.confirmations === null ? 0 : sqlLiteral(event.confirmations)},
      ${sqlLiteral(event.createdAt)}
    );
  `);
};

const getLatestSettlementRows = (merchantId, accountId) => {
  const latestBySettlement = new Map();
  const settlementRows = all(`
    SELECT
      settlement_id AS settlementId,
      api_id AS apiId,
      api_route AS apiRoute,
      api_name AS apiName,
      source_network AS sourceNetwork,
      destination_network AS destinationNetwork,
      amount,
      status,
      tx_hash AS txHash,
      source_tx_hash AS sourceTxHash,
      bridge_tx_hash AS bridgeTxHash,
      destination_tx_hash AS destinationTxHash,
      block_number AS blockNumber,
      log_index AS logIndex,
      confirmations,
      created_at AS createdAt
    FROM treasury_settlement_events
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
    ORDER BY created_at ASC;
  `);

  settlementRows.forEach((row) => {
    const previous = latestBySettlement.get(row.settlementId);
    if (!previous || statusPrecedence(row.status) >= statusPrecedence(previous.status)) {
      latestBySettlement.set(row.settlementId, row);
    }
  });

  return [...latestBySettlement.values()];
};

const aggregateBalances = (merchantId, accountId) => {
  const latestSettlementRows = getLatestSettlementRows(merchantId, accountId);
  const aggregated = new Map();

  const add = (network, delta) => {
    const current = aggregated.get(network) || 0n;
    aggregated.set(network, current + delta);
  };

  latestSettlementRows.forEach((row) => {
    if (row.status === "failed") {
      return;
    }

    const amount = BigInt(row.amount);
    const network =
      row.status === "bridge_confirmed" && row.destinationNetwork
        ? row.destinationNetwork
        : row.sourceNetwork;

    add(network, amount);
  });

  const consolidationRows = all(`
    SELECT source_network AS sourceNetwork, destination_network AS destinationNetwork, amount
    FROM treasury_consolidations
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
      AND status = 'confirmed';
  `);

  consolidationRows.forEach((row) => {
    const amount = BigInt(row.amount);
    add(row.sourceNetwork, -amount);
    add(row.destinationNetwork, amount);
  });

  const payoutRows = all(`
    SELECT network, amount
    FROM treasury_payout_requests
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
      AND status = 'completed';
  `);

  payoutRows.forEach((row) => {
    const amount = BigInt(row.amount);
    add(row.network, -amount);
  });

  return aggregated;
};

export const recomputeBalances = (merchantId, accountId) => {
  const balances = aggregateBalances(merchantId, accountId);
  run(`
    DELETE FROM treasury_balances
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)};
  `);

  const updatedAt = nowIso();
  balances.forEach((amount, network) => {
    if (amount <= 0n) {
      return;
    }

    run(`
      INSERT OR REPLACE INTO treasury_balances (
        merchant_id,
        account_id,
        network,
        asset,
        amount,
        usd_value,
        updated_at
      ) VALUES (
        ${sqlLiteral(merchantId)},
        ${sqlLiteral(accountId)},
        ${sqlLiteral(network)},
        'USDC',
        ${sqlLiteral(amount.toString())},
        ${sqlLiteral(toDecimalUsdcString(amount))},
        ${sqlLiteral(updatedAt)}
      );
    `);
  });
};

export const getBalances = (merchantId, accountId) =>
  all(`
    SELECT
      network,
      asset,
      amount,
      usd_value AS usdValue,
      updated_at AS updatedAt
    FROM treasury_balances
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
    ORDER BY network ASC;
  `);

export const getUnifiedUsd = (merchantId, accountId) => {
  const balances = getBalances(merchantId, accountId);
  const totalBaseUnits = balances.reduce((sum, row) => sum + BigInt(row.amount), 0n);
  return toDecimalUsdcString(totalBaseUnits);
};

export const getAvailableBalanceForNetwork = (merchantId, accountId, network) => {
  const row = one(`
    SELECT amount
    FROM treasury_balances
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
      AND network = ${sqlLiteral(network)}
      AND asset = 'USDC'
    LIMIT 1;
  `);
  return BigInt(row?.amount || "0");
};

export const createConsolidation = (input) => {
  const id = newId();
  const createdAt = nowIso();

  run(`
    INSERT INTO treasury_consolidations (
      id,
      merchant_id,
      account_id,
      source_network,
      destination_network,
      asset,
      amount,
      status,
      fail_reason,
      tx_hash,
      source_tx_hash,
      bridge_tx_hash,
      destination_tx_hash,
      created_at,
      updated_at
    ) VALUES (
      ${sqlLiteral(id)},
      ${sqlLiteral(input.merchantId)},
      ${sqlLiteral(input.accountId)},
      ${sqlLiteral(input.sourceNetwork)},
      ${sqlLiteral(input.destinationNetwork)},
      'USDC',
      ${sqlLiteral(input.amount)},
      'requested',
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      ${sqlLiteral(createdAt)},
      ${sqlLiteral(createdAt)}
    );
  `);

  return id;
};

export const updateConsolidationStatus = (id, status, patch = {}) => {
  const failReason = patch.failReason === undefined ? null : patch.failReason;
  const txHash = patch.txHash === undefined ? null : patch.txHash;
  const sourceTxHash = patch.sourceTxHash === undefined ? null : patch.sourceTxHash;
  const bridgeTxHash = patch.bridgeTxHash === undefined ? null : patch.bridgeTxHash;
  const destinationTxHash = patch.destinationTxHash === undefined ? null : patch.destinationTxHash;

  run(`
    UPDATE treasury_consolidations
    SET
      status = ${sqlLiteral(status)},
      fail_reason = ${sqlLiteral(failReason)},
      tx_hash = ${sqlLiteral(txHash)},
      source_tx_hash = ${sqlLiteral(sourceTxHash)},
      bridge_tx_hash = ${sqlLiteral(bridgeTxHash)},
      destination_tx_hash = ${sqlLiteral(destinationTxHash)},
      updated_at = ${sqlLiteral(nowIso())}
    WHERE id = ${sqlLiteral(id)};
  `);
};

export const getConsolidation = (id) =>
  one(`
    SELECT
      id,
      merchant_id AS merchantId,
      account_id AS accountId,
      source_network AS sourceNetwork,
      destination_network AS destinationNetwork,
      asset,
      amount,
      status,
      fail_reason AS failReason,
      tx_hash AS txHash,
      source_tx_hash AS sourceTxHash,
      bridge_tx_hash AS bridgeTxHash,
      destination_tx_hash AS destinationTxHash,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM treasury_consolidations
    WHERE id = ${sqlLiteral(id)}
    LIMIT 1;
  `);

export const createPayoutRequest = (input) => {
  const id = newId();
  const createdAt = nowIso();
  run(`
    INSERT INTO treasury_payout_requests (
      id,
      merchant_id,
      account_id,
      network,
      asset,
      amount,
      destination_address,
      status,
      created_at,
      updated_at
    ) VALUES (
      ${sqlLiteral(id)},
      ${sqlLiteral(input.merchantId)},
      ${sqlLiteral(input.accountId)},
      ${sqlLiteral(input.network)},
      'USDC',
      ${sqlLiteral(input.amount)},
      ${sqlLiteral(input.destinationAddress)},
      'requested',
      ${sqlLiteral(createdAt)},
      ${sqlLiteral(createdAt)}
    );
  `);
  return id;
};

export const updatePayoutStatus = (id, status) => {
  run(`
    UPDATE treasury_payout_requests
    SET
      status = ${sqlLiteral(status)},
      updated_at = ${sqlLiteral(nowIso())}
    WHERE id = ${sqlLiteral(id)};
  `);
};

export const getPayoutRequest = (id) =>
  one(`
    SELECT
      id,
      merchant_id AS merchantId,
      account_id AS accountId,
      network,
      asset,
      amount,
      destination_address AS destinationAddress,
      status,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM treasury_payout_requests
    WHERE id = ${sqlLiteral(id)}
    LIMIT 1;
  `);

export const getApiRevenueBreakdown = (merchantId, accountId, limit = 20) => {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 200)) : 20;
  const latestSettlementRows = getLatestSettlementRows(merchantId, accountId);
  const apiProducts = listApiProducts(merchantId, accountId);
  const singleApiProduct = apiProducts.length === 1 ? apiProducts[0] : null;
  const byApi = new Map();

  latestSettlementRows.forEach((row) => {
    if (row.status === "failed") {
      return;
    }

    const fallbackApiRoute = singleApiProduct ? `${singleApiProduct.method} ${singleApiProduct.path}` : null;
    const apiId = row.apiId || singleApiProduct?.apiId || row.apiRoute || "unknown";
    const apiRoute = row.apiRoute || fallbackApiRoute || "Unknown API";
    const key = `${apiId}::${apiRoute}`;
    const amount = BigInt(row.amount);

    const existing = byApi.get(key) || {
      apiId,
      apiRoute,
      apiName: row.apiName || singleApiProduct?.apiName || null,
      totalBaseUnits: 0n,
      settlementsCount: 0,
      latestAt: row.createdAt
    };

    existing.totalBaseUnits += amount;
    existing.settlementsCount += 1;

    if (row.createdAt > existing.latestAt) {
      existing.latestAt = row.createdAt;
      if (row.apiName) {
        existing.apiName = row.apiName;
      }
    } else if (!existing.apiName && row.apiName) {
      existing.apiName = row.apiName;
    }

    byApi.set(key, existing);
  });

  const allItems = [...byApi.values()]
    .sort((a, b) => {
      if (a.totalBaseUnits === b.totalBaseUnits) {
        return a.latestAt < b.latestAt ? 1 : -1;
      }
      return a.totalBaseUnits > b.totalBaseUnits ? -1 : 1;
    })
    .map((row) => ({
      apiId: row.apiId,
      apiRoute: row.apiRoute,
      apiName: row.apiName,
      settlementsCount: row.settlementsCount,
      totalAmount: row.totalBaseUnits.toString(),
      totalUsd: toDecimalUsdcString(row.totalBaseUnits),
      latestAt: row.latestAt
    }));

  const items = allItems.slice(0, safeLimit);
  const totalBaseUnits = allItems.reduce((sum, row) => sum + BigInt(row.totalAmount), 0n);
  return {
    items,
    totals: {
      apiCount: items.length,
      totalAmount: totalBaseUnits.toString(),
      totalUsd: toDecimalUsdcString(totalBaseUnits)
    }
  };
};

export const getTimeline = (merchantId, accountId, limit = 100) => {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 200)) : 100;
  const settlementRows = all(`
    SELECT
      'settlement' AS itemType,
      event_id AS id,
      settlement_id AS settlementId,
      api_id AS apiId,
      api_route AS apiRoute,
      api_name AS apiName,
      source_network AS sourceNetwork,
      destination_network AS destinationNetwork,
      asset,
      amount,
      status,
      tx_hash AS txHash,
      source_tx_hash AS sourceTxHash,
      bridge_tx_hash AS bridgeTxHash,
      destination_tx_hash AS destinationTxHash,
      block_number AS blockNumber,
      log_index AS logIndex,
      confirmations,
      created_at AS createdAt
    FROM treasury_settlement_events
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
  `);

  const consolidationRows = all(`
    SELECT
      'consolidation' AS itemType,
      id,
      id AS settlementId,
      NULL AS apiId,
      NULL AS apiRoute,
      NULL AS apiName,
      source_network AS sourceNetwork,
      destination_network AS destinationNetwork,
      asset,
      amount,
      status,
      tx_hash AS txHash,
      source_tx_hash AS sourceTxHash,
      bridge_tx_hash AS bridgeTxHash,
      destination_tx_hash AS destinationTxHash,
      NULL AS blockNumber,
      NULL AS logIndex,
      NULL AS confirmations,
      created_at AS createdAt
    FROM treasury_consolidations
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
  `);

  const payoutRows = all(`
    SELECT
      'payout' AS itemType,
      id,
      id AS settlementId,
      NULL AS apiId,
      NULL AS apiRoute,
      NULL AS apiName,
      network AS sourceNetwork,
      NULL AS destinationNetwork,
      asset,
      amount,
      status,
      NULL AS txHash,
      NULL AS sourceTxHash,
      NULL AS bridgeTxHash,
      NULL AS destinationTxHash,
      NULL AS blockNumber,
      NULL AS logIndex,
      NULL AS confirmations,
      created_at AS createdAt
    FROM treasury_payout_requests
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
  `);

  return [...settlementRows, ...consolidationRows, ...payoutRows]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, safeLimit);
};
