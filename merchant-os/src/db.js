import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";
import {
  decryptCustodyPrivateKey,
  encryptCustodyPrivateKey,
  generateCustodyWallet,
  isValidCustodyMasterKey
} from "./custodyKeyManager.js";
import { normalizeUsdcAsset } from "./services/usdcRoutingService.js";
import { addHoursIso, newId, nowIso, statusPrecedence, toDecimalUsdcString } from "./utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const schemaPath = join(__dirname, "schema.sql");
const PASSWORD_HASH_ITERATIONS = 210000;
const PASSWORD_HASH_KEYLEN = 64;
const PASSWORD_HASH_DIGEST = "sha512";
const PAYMENT_CONTEXT_TTL_HOURS = 1;

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

const resolveUsdcAssetForNetwork = (network) => {
  try {
    const row = one(`
      SELECT usdc_address AS usdcAddress
      FROM chain_catalog
      WHERE network = ${sqlLiteral(network)}
      LIMIT 1;
    `);
    if (row?.usdcAddress && /^0x[a-fA-F0-9]{40}$/.test(String(row.usdcAddress))) {
      return String(row.usdcAddress);
    }
  } catch {
    // chain catalog may not exist on first boot; fallback below.
  }
  return DEFAULT_USDC_ASSET;
};
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

const normalizePaymentContextPayTo = (value) => {
  const normalizedAddress = normalizeEvmAddress(value);
  if (normalizedAddress) {
    return normalizedAddress.toLowerCase();
  }
  return String(value || "").trim();
};

const normalizeTreasuryMode = (value) =>
  String(value || "").trim().toLowerCase() === "private" ? "private" : "public";

const normalizePaymentContextAsset = (value) => {
  const normalizedUsdc = normalizeUsdcAsset(value);
  if (normalizedUsdc) {
    return normalizedUsdc;
  }
  return String(value || "").trim().toLowerCase();
};

const CUSTODY_MASTER_KEY_ERROR =
  "MERCHANT_OS_CUSTODY_MASTER_KEY is required and must be a 32-byte hex string (64 hex chars, optional 0x prefix)";

const assertCustodyMasterKeyConfigured = () => {
  if (!isValidCustodyMasterKey(config.custodyMasterKey)) {
    throw new Error(CUSTODY_MASTER_KEY_ERROR);
  }
};

// Enforce master-key presence at module load so startup fails fast if missing.
assertCustodyMasterKeyConfigured();

const toSeedHex = (value) => {
  const text = String(value || "").trim().toLowerCase().replace(/^0x/, "");
  return /^[0-9a-f]{64}$/.test(text) ? text : "";
};

const mpcDerivationSeedHex = toSeedHex(config.custodyMasterKey);

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

const deriveTenantMpcPrivateKey = (merchantId, accountId) => {
  const seed = `${mpcDerivationSeedHex}:${merchantId}:${accountId}:mpc:v1`;
  const digest = createHash("sha256").update(seed).digest("hex");
  const fallbackDigest = createHash("sha256").update(`${seed}:fallback`).digest("hex");
  const privateKeyHex = /^0+$/.test(digest) ? fallbackDigest : digest;
  return `0x${privateKeyHex}`;
};

const deriveTenantMpcAddress = (merchantId, accountId) => {
  const privateKey = deriveTenantMpcPrivateKey(merchantId, accountId);
  return privateKeyToAccount(privateKey).address;
};

const sha256Hex = (value) => createHash("sha256").update(String(value)).digest("hex");

const hashPassword = (password) => {
  const normalized = String(password || "");
  if (!normalized) {
    throw new Error("password is required");
  }
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(
    normalized,
    salt,
    PASSWORD_HASH_ITERATIONS,
    PASSWORD_HASH_KEYLEN,
    PASSWORD_HASH_DIGEST
  ).toString("hex");
  return `pbkdf2$${PASSWORD_HASH_DIGEST}$${PASSWORD_HASH_ITERATIONS}$${salt}$${hash}`;
};

const verifyPasswordHash = (encoded, password) => {
  const text = String(encoded || "");
  if (!text.startsWith("pbkdf2$")) {
    return false;
  }

  const parts = text.split("$");
  if (parts.length !== 5) {
    return false;
  }
  const [, algo, iterationsRaw, salt, expectedHash] = parts;
  const iterations = Number.parseInt(iterationsRaw, 10);
  if (!algo || !salt || !expectedHash || Number.isNaN(iterations) || iterations <= 0) {
    return false;
  }
  const calculated = pbkdf2Sync(
    String(password || ""),
    salt,
    iterations,
    expectedHash.length / 2,
    algo
  );
  const expected = Buffer.from(expectedHash, "hex");
  if (calculated.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(calculated, expected);
};

const buildApiKey = () => {
  const raw = `rb_live_${randomBytes(24).toString("base64url")}`;
  const prefix = raw.slice(0, 16);
  return {
    raw,
    prefix,
    hash: sha256Hex(raw)
  };
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
  try {
    return JSON.parse(output);
  } catch (error) {
    console.warn(
      `[merchant-os][db] Failed to parse sqlite JSON output: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
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
  ensureColumn("merchants", "status", "TEXT NOT NULL DEFAULT 'active'");
  ensureColumn("merchants", "compliance_profile_json", "TEXT");
  ensureColumn("merchant_users", "password_hash_algo", "TEXT NOT NULL DEFAULT 'pbkdf2_sha512'");
  ensureColumn("merchant_users", "status", "TEXT NOT NULL DEFAULT 'active'");
  ensureColumn("merchant_accounts", "status", "TEXT NOT NULL DEFAULT 'active'");
  ensureColumn("merchant_account_wallets", "signer_provider", "TEXT NOT NULL DEFAULT 'mpc'");
  ensureColumn("merchant_account_wallets", "signer_reference", "TEXT");
  ensureColumn("treasury_policy", "treasury_mode", "TEXT NOT NULL DEFAULT 'public'");
  ensureColumn("treasury_policy", "private_home_network", "TEXT");
  ensureColumn("treasury_policy", "privacy_enabled_at", "TEXT");
  ensureColumn("treasury_settlement_events", "api_id", "TEXT");
  ensureColumn("treasury_settlement_events", "api_route", "TEXT");
  ensureColumn("treasury_settlement_events", "api_name", "TEXT");
  ensureColumn("treasury_settlement_events", "source_tx_hash", "TEXT");
  ensureColumn("treasury_settlement_events", "bridge_tx_hash", "TEXT");
  ensureColumn("treasury_settlement_events", "destination_tx_hash", "TEXT");
  // Deduplicate legacy settlement rows before enforcing tenant tx/status uniqueness.
  run(`
    DELETE FROM treasury_settlement_events
    WHERE rowid NOT IN (
      SELECT MIN(rowid)
      FROM treasury_settlement_events
      GROUP BY merchant_id, account_id, tx_hash, status
    );
  `);
  run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_tenant_tx_status
    ON treasury_settlement_events(merchant_id, account_id, tx_hash, status);
  `);
  ensureColumn("treasury_settlement_events", "block_number", "INTEGER");
  ensureColumn("treasury_settlement_events", "log_index", "INTEGER");
  ensureColumn("treasury_settlement_events", "confirmations", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("treasury_settlement_events", "fail_reason", "TEXT");
  ensureColumn("treasury_consolidations", "tx_hash", "TEXT");
  ensureColumn("treasury_consolidations", "source_tx_hash", "TEXT");
  ensureColumn("treasury_consolidations", "bridge_tx_hash", "TEXT");
  ensureColumn("treasury_consolidations", "destination_tx_hash", "TEXT");
  ensureColumn("treasury_payout_requests", "fail_reason", "TEXT");
  ensureColumn("treasury_payout_requests", "tx_hash", "TEXT");
  run(`
    CREATE INDEX IF NOT EXISTS idx_settlement_source_tx
      ON treasury_settlement_events(source_network, source_tx_hash, log_index);
  `);
  run(`
    CREATE INDEX IF NOT EXISTS idx_treasury_consolidations_tenant_created
      ON treasury_consolidations(merchant_id, account_id, created_at DESC);
  `);
  run(`
    CREATE TABLE IF NOT EXISTS payment_requirement_contexts (
      id TEXT PRIMARY KEY,
      payment_context_id TEXT NOT NULL UNIQUE,
      merchant_id TEXT NOT NULL REFERENCES merchants(id),
      account_id TEXT NOT NULL REFERENCES merchant_accounts(id),
      api_product_id TEXT,
      treasury_mode TEXT NOT NULL,
      privacy_coverage_mode TEXT,
      private_home_network TEXT,
      scheme TEXT NOT NULL,
      source_network TEXT NOT NULL,
      destination_network TEXT,
      asset TEXT NOT NULL,
      amount TEXT NOT NULL,
      public_pay_to TEXT NOT NULL,
      settlement_id TEXT,
      status TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      settled_at TEXT,
      consumed_at TEXT,
      metadata_json TEXT
    );
  `);
  run(`
    CREATE INDEX IF NOT EXISTS idx_payment_requirement_contexts_tenant_issued
      ON payment_requirement_contexts(merchant_id, account_id, issued_at DESC);
  `);
  run(`
    CREATE INDEX IF NOT EXISTS idx_payment_requirement_contexts_status_expires
      ON payment_requirement_contexts(status, expires_at);
  `);
  run(`
    CREATE INDEX IF NOT EXISTS idx_payment_requirement_contexts_settlement
      ON payment_requirement_contexts(settlement_id);
  `);
  run(`
    CREATE TABLE IF NOT EXISTS private_accounts (
      id TEXT PRIMARY KEY,
      merchant_id TEXT REFERENCES merchants(id),
      account_id TEXT REFERENCES merchant_accounts(id),
      provider TEXT NOT NULL,
      environment TEXT NOT NULL,
      network TEXT NOT NULL,
      role TEXT NOT NULL,
      unlink_address TEXT,
      key_reference TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  run(`
    CREATE INDEX IF NOT EXISTS idx_private_accounts_tenant
      ON private_accounts(merchant_id, account_id, provider, environment, role);
  `);
  run(`
    CREATE TABLE IF NOT EXISTS private_ledger_entries (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL REFERENCES merchants(id),
      account_id TEXT NOT NULL REFERENCES merchant_accounts(id),
      provider TEXT NOT NULL,
      environment TEXT NOT NULL,
      network TEXT NOT NULL,
      asset TEXT NOT NULL,
      entry_type TEXT NOT NULL,
      direction TEXT NOT NULL,
      amount TEXT NOT NULL,
      available_delta TEXT NOT NULL,
      pending_sweep_delta TEXT NOT NULL,
      pending_withdrawal_delta TEXT NOT NULL,
      reference_type TEXT NOT NULL,
      reference_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );
  `);
  run(`
    CREATE INDEX IF NOT EXISTS idx_private_ledger_entries_tenant_created
      ON private_ledger_entries(merchant_id, account_id, network, created_at DESC);
  `);
  run(`
    CREATE INDEX IF NOT EXISTS idx_private_ledger_entries_reference
      ON private_ledger_entries(reference_type, reference_id);
  `);
  run(`
    CREATE TABLE IF NOT EXISTS omnibus_sweeps (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL REFERENCES merchants(id),
      account_id TEXT NOT NULL REFERENCES merchant_accounts(id),
      provider TEXT NOT NULL,
      environment TEXT NOT NULL,
      network TEXT NOT NULL,
      asset TEXT NOT NULL,
      settlement_id TEXT NOT NULL,
      payment_context_id TEXT,
      amount TEXT NOT NULL,
      omnibus_account_id TEXT,
      provider_tx_id TEXT,
      provider_tx_hash TEXT,
      status TEXT NOT NULL,
      fail_reason TEXT,
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  run(`
    CREATE INDEX IF NOT EXISTS idx_omnibus_sweeps_tenant_created
      ON omnibus_sweeps(merchant_id, account_id, created_at DESC);
  `);
  run(`
    CREATE TABLE IF NOT EXISTS private_transfers (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL REFERENCES merchants(id),
      account_id TEXT NOT NULL REFERENCES merchant_accounts(id),
      provider TEXT NOT NULL,
      environment TEXT NOT NULL,
      network TEXT NOT NULL,
      asset TEXT NOT NULL,
      settlement_id TEXT NOT NULL,
      payment_context_id TEXT,
      amount TEXT NOT NULL,
      from_account_id TEXT,
      to_account_id TEXT,
      to_unlink_address TEXT,
      provider_tx_id TEXT,
      provider_tx_hash TEXT,
      status TEXT NOT NULL,
      fail_reason TEXT,
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  run(`
    CREATE INDEX IF NOT EXISTS idx_private_transfers_tenant_created
      ON private_transfers(merchant_id, account_id, created_at DESC);
  `);
  run(`
    CREATE TABLE IF NOT EXISTS private_balance_snapshots (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL REFERENCES merchants(id),
      account_id TEXT NOT NULL REFERENCES merchant_accounts(id),
      provider TEXT NOT NULL,
      environment TEXT NOT NULL,
      network TEXT NOT NULL,
      asset TEXT NOT NULL,
      amount TEXT NOT NULL,
      freshness TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      source_updated_at TEXT
    );
  `);
  run(`
    CREATE INDEX IF NOT EXISTS idx_private_balance_snapshots_tenant_recorded
      ON private_balance_snapshots(merchant_id, account_id, network, recorded_at DESC);
  `);
  run(`
    CREATE TABLE IF NOT EXISTS chain_catalog (
      network TEXT PRIMARY KEY,
      chain_name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      chain_type TEXT NOT NULL DEFAULT 'evm',
      usdc_address TEXT NOT NULL,
      rpc_endpoints_json TEXT NOT NULL,
      explorer_url TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      source TEXT NOT NULL DEFAULT 'circle_bridge_kit',
      source_updated_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  run(`
    CREATE INDEX IF NOT EXISTS idx_chain_catalog_status
      ON chain_catalog(status);
  `);
  run(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL REFERENCES merchants(id),
      account_id TEXT NOT NULL REFERENCES merchant_accounts(id),
      name TEXT NOT NULL,
      key_prefix TEXT NOT NULL UNIQUE,
      key_hash TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK(role IN ('admin', 'finance', 'readonly')),
      status TEXT NOT NULL DEFAULT 'active',
      created_by_user_id TEXT REFERENCES merchant_users(id),
      last_used_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  run(`
    CREATE INDEX IF NOT EXISTS idx_api_keys_tenant
      ON api_keys(merchant_id, account_id, status);
  `);
  run(`
    CREATE TABLE IF NOT EXISTS webhook_endpoints (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL REFERENCES merchants(id),
      account_id TEXT NOT NULL REFERENCES merchant_accounts(id),
      url TEXT NOT NULL,
      signing_secret TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      last_test_status TEXT,
      last_test_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  run(`
    CREATE INDEX IF NOT EXISTS idx_webhooks_tenant
      ON webhook_endpoints(merchant_id, account_id, status);
  `);
  run(`
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL REFERENCES webhook_endpoints(id),
      merchant_id TEXT NOT NULL REFERENCES merchants(id),
      account_id TEXT NOT NULL REFERENCES merchant_accounts(id),
      event_type TEXT NOT NULL,
      event_id TEXT NOT NULL,
      request_body TEXT NOT NULL,
      response_status INTEGER,
      response_body TEXT,
      error TEXT,
      created_at TEXT NOT NULL
    );
  `);
  run(`
    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_event
      ON webhook_deliveries(event_id, event_type);
  `);
  run(`
    CREATE TABLE IF NOT EXISTS payout_address_book_entries (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL REFERENCES merchants(id),
      account_id TEXT NOT NULL REFERENCES merchant_accounts(id),
      label TEXT NOT NULL,
      network TEXT NOT NULL,
      address TEXT NOT NULL,
      last_used_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(merchant_id, account_id, network, address)
    );
  `);
  run(`
    CREATE INDEX IF NOT EXISTS idx_payout_address_book_tenant
      ON payout_address_book_entries(merchant_id, account_id, network, created_at);
  `);
  run(`
    CREATE TABLE IF NOT EXISTS bridge_jobs (
      id TEXT PRIMARY KEY,
      settlement_id TEXT NOT NULL,
      merchant_id TEXT NOT NULL REFERENCES merchants(id),
      account_id TEXT NOT NULL REFERENCES merchant_accounts(id),
      source_network TEXT NOT NULL,
      destination_network TEXT NOT NULL,
      destination_address TEXT NOT NULL,
      asset TEXT NOT NULL,
      amount TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      next_retry_at TEXT,
      last_error TEXT,
      source_tx_hash TEXT,
      bridge_tx_hash TEXT,
      destination_tx_hash TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  run(`
    CREATE INDEX IF NOT EXISTS idx_bridge_jobs_status
      ON bridge_jobs(status, next_retry_at);
  `);
  run(`
    CREATE TABLE IF NOT EXISTS tenant_mutation_locks (
      lock_key TEXT PRIMARY KEY,
      owner_token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  run(`
    CREATE INDEX IF NOT EXISTS idx_tenant_mutation_locks_expires
      ON tenant_mutation_locks(expires_at);
  `);
};

const migrateLegacyPlaintextPasswords = () => {
  const legacyUsers = all(`
    SELECT id, password_hash AS passwordHash, password_hash_algo AS passwordHashAlgo
    FROM merchant_users
    WHERE password_hash_algo = 'legacy_plaintext';
  `);

  legacyUsers.forEach((user) => {
    const plaintext = String(user.passwordHash || "");
    if (!plaintext) {
      return;
    }
    const upgradedHash = hashPassword(plaintext);
    run(`
      UPDATE merchant_users
      SET
        password_hash = ${sqlLiteral(upgradedHash)},
        password_hash_algo = 'pbkdf2_sha512'
      WHERE id = ${sqlLiteral(user.id)};
    `);
  });
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

const resolveSeedPrivateKeyForTenant = (merchantId, accountId) => {
  const existing = getFirstCustodyKeyRecordForTenant(merchantId, accountId);
  if (existing) {
    return decryptCustodyPrivateKey(existing, config.custodyMasterKey);
  }

  const generated = generateCustodyWallet();
  return generated.privateKey;
};

const ensureCustodyKeyForWallet = (wallet) => {
  if (String(wallet.keyReference || "").startsWith("mpc:")) {
    return null;
  }
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
    if (String(wallet.keyReference || "").startsWith("mpc:")) {
      return;
    }
    ensureCustodyKeyForWallet(wallet);
  });
};

const alignMpcWalletAddressesToTenantCustody = () => {
  if (!config.mpcCustodyEnabled) {
    return;
  }

  const mpcWallets = all(`
    SELECT
      merchant_id AS merchantId,
      account_id AS accountId,
      key_reference AS keyReference,
      address
    FROM merchant_account_wallets
    WHERE asset = 'USDC'
      AND key_reference LIKE 'mpc:%';
  `);

  mpcWallets.forEach((wallet) => {
    const nextAddress = deriveTenantMpcAddress(wallet.merchantId, wallet.accountId);
    if (normalizeEvmAddress(wallet.address) !== normalizeEvmAddress(nextAddress)) {
      updateWalletAddressByReference(
        wallet.merchantId,
        wallet.accountId,
        wallet.keyReference,
        nextAddress
      );
    }
  });
};

export const initializeDatabase = () => {
  assertCustodyMasterKeyConfigured();
  ensureDbDirectory();
  run("PRAGMA journal_mode = WAL;");
  run("PRAGMA foreign_keys = ON;");
  run(readFileSync(schemaPath, "utf8"));
  runSchemaMigrations();
  migrateLegacyPlaintextPasswords();

  if (!config.mpcCustodyEnabled) {
    backfillCustodyKeysForWallets();
  }
  alignMpcWalletAddressesToTenantCustody();
};

export const resetDatabase = () => {
  if (existsSync(config.dbPath)) {
    rmSync(config.dbPath);
  }
  initializeDatabase();
  // Seed demo premium route only on explicit DB reset (not every API restart).
  alignDemoApiProductSourceNetwork();
};

export const listWorkspaceLoginIdentities = () =>
  all(`
    SELECT
      m.id AS merchantId,
      m.name AS merchantName,
      a.id AS accountId,
      a.account_name AS accountName,
      u.email,
      u.role
    FROM merchant_users u
    JOIN merchants m ON m.id = u.merchant_id
    JOIN merchant_accounts a ON a.merchant_id = m.id
    WHERE u.status = 'active'
      AND a.status = 'active'
      AND m.status = 'active'
    ORDER BY m.created_at ASC, u.created_at ASC;
  `);

export const getTenantProfile = (merchantId, accountId) =>
  one(`
    SELECT
      m.id AS merchantId,
      a.id AS accountId,
      m.name AS merchantName,
      a.account_name AS accountName,
      (
        SELECT u.email
        FROM merchant_users u
        WHERE u.merchant_id = m.id
          AND u.status = 'active'
        ORDER BY CASE WHEN u.role = 'admin' THEN 0 ELSE 1 END, u.created_at ASC
        LIMIT 1
      ) AS userEmail,
      (
        SELECT u.role
        FROM merchant_users u
        WHERE u.merchant_id = m.id
          AND u.status = 'active'
        ORDER BY CASE WHEN u.role = 'admin' THEN 0 ELSE 1 END, u.created_at ASC
        LIMIT 1
      ) AS userRole
    FROM merchants m
    JOIN merchant_accounts a ON a.merchant_id = m.id
    WHERE m.id = ${sqlLiteral(merchantId)}
      AND a.id = ${sqlLiteral(accountId)}
      AND m.status = 'active'
      AND a.status = 'active'
    LIMIT 1;
  `);

export const updateTenantProfile = ({
  merchantId,
  accountId,
  actingUserId = "",
  merchantName,
  accountName,
  userEmail
}) => {
  const existing = getTenantProfile(merchantId, accountId);
  if (!existing) {
    return null;
  }

  const nextMerchantName = merchantName !== undefined ? String(merchantName || "").trim() : null;
  const nextAccountName = accountName !== undefined ? String(accountName || "").trim() : null;
  const nextUserEmail = userEmail !== undefined ? String(userEmail || "").trim().toLowerCase() : null;

  if (nextMerchantName !== null) {
    run(`
      UPDATE merchants
      SET name = ${sqlLiteral(nextMerchantName)}
      WHERE id = ${sqlLiteral(merchantId)}
        AND status = 'active';
    `);
  }

  if (nextAccountName !== null) {
    run(`
      UPDATE merchant_accounts
      SET account_name = ${sqlLiteral(nextAccountName)}
      WHERE id = ${sqlLiteral(accountId)}
        AND merchant_id = ${sqlLiteral(merchantId)}
        AND status = 'active';
    `);
  }

  if (nextUserEmail !== null) {
    const targetUser = one(`
      SELECT id
      FROM merchant_users
      WHERE merchant_id = ${sqlLiteral(merchantId)}
        AND status = 'active'
      ORDER BY
        CASE
          WHEN id = ${sqlLiteral(actingUserId)} THEN 0
          WHEN role = 'admin' THEN 1
          ELSE 2
        END,
        created_at ASC
      LIMIT 1;
    `);

    if (targetUser?.id) {
      run(`
        UPDATE merchant_users
        SET email = ${sqlLiteral(nextUserEmail)}
        WHERE id = ${sqlLiteral(targetUser.id)}
          AND merchant_id = ${sqlLiteral(merchantId)}
          AND status = 'active';
      `);
    }
  }

  return getTenantProfile(merchantId, accountId);
};

export const onboardMerchantAccount = ({
  merchantName,
  adminEmail,
  adminPassword,
  complianceProfile = null,
  chainProfiles = []
}) => {
  const organization = createMerchantOrganization({
    merchantName,
    accountName: `${merchantName} Treasury`,
    complianceProfile
  });

  const adminUser = createPlatformUser({
    merchantId: organization.merchantId,
    email: adminEmail,
    password: adminPassword,
    role: "admin"
  });

  (chainProfiles || []).forEach((chain) => {
    const normalizedNetwork = String(chain.network || "").trim();
    const normalizedAddress = normalizeEvmAddress(chain.address);
    if (!normalizedNetwork || !normalizedAddress) {
      return;
    }
    const signerReference =
      String(chain.signerReference || "").trim() || `mpc:${organization.merchantId}:${normalizedNetwork}`;
    createWalletProfile({
      merchantId: organization.merchantId,
      accountId: organization.accountId,
      network: normalizedNetwork,
      address: normalizedAddress,
      signerProvider: "mpc",
      signerReference
    });
  });

  const firstNetwork = chainProfiles[0]?.network || resolveDemoSourceNetwork();
  upsertPolicy(organization.merchantId, organization.accountId, {
    preferredNetwork: firstNetwork,
    autoBridgeEnabled: true
  });

  return {
    merchantId: organization.merchantId,
    accountId: organization.accountId,
    adminUserId: adminUser.id
  };
};

export const authenticatePlatformUser = (email, password) => {
  const user = one(`
    SELECT
      u.id,
      u.merchant_id AS merchantId,
      m.name AS merchantName,
      u.email,
      u.role,
      u.password_hash AS passwordHash,
      u.password_hash_algo AS passwordHashAlgo,
      u.status
    FROM merchant_users u
    JOIN merchants m ON m.id = u.merchant_id
    WHERE lower(u.email) = ${sqlLiteral(String(email || "").trim().toLowerCase())}
      AND u.status = 'active'
      AND m.status = 'active'
    LIMIT 1;
  `);

  if (!user) {
    return null;
  }
  const storedAlgo = String(user.passwordHashAlgo || "").trim();
  if (storedAlgo === "pbkdf2_sha512") {
    if (!verifyPasswordHash(user.passwordHash, password)) {
      return null;
    }
  } else if (storedAlgo === "legacy_plaintext") {
    if (String(user.passwordHash || "") !== String(password || "")) {
      return null;
    }

    // Upgrade successful legacy auth to PBKDF2 immediately.
    const upgradedHash = hashPassword(password);
    run(`
      UPDATE merchant_users
      SET
        password_hash = ${sqlLiteral(upgradedHash)},
        password_hash_algo = 'pbkdf2_sha512'
      WHERE id = ${sqlLiteral(user.id)};
    `);
  } else {
    return null;
  }

  const activeAccounts = all(`
    SELECT
      id AS accountId,
      account_name AS accountName,
      created_at AS createdAt
    FROM merchant_accounts
    WHERE merchant_id = ${sqlLiteral(user.merchantId)}
      AND status = 'active'
    ORDER BY created_at ASC;
  `);
  if (!activeAccounts.length) {
    return null;
  }

  let selectedAccount = activeAccounts[0];
  if (activeAccounts.length > 1) {
    const preferredAccount = one(`
      SELECT
        account_id AS accountId
      FROM api_keys
      WHERE merchant_id = ${sqlLiteral(user.merchantId)}
        AND created_by_user_id = ${sqlLiteral(user.id)}
        AND status = 'active'
      ORDER BY
        (last_used_at IS NULL) ASC,
        last_used_at DESC,
        created_at DESC
      LIMIT 1;
    `);
    if (!preferredAccount?.accountId) {
      return null;
    }
    selectedAccount =
      activeAccounts.find((account) => account.accountId === preferredAccount.accountId) || null;
    if (!selectedAccount) {
      return null;
    }
  }

  return {
    id: user.id,
    merchantId: user.merchantId,
    accountId: selectedAccount.accountId,
    merchantName: user.merchantName,
    accountName: selectedAccount.accountName,
    email: user.email,
    role: user.role
  };
};

export const createPlatformUser = ({
  merchantId,
  email,
  password,
  role = "admin"
}) => {
  const userId = newId();
  const createdAt = nowIso();
  const passwordHash = hashPassword(password);
  run(`
    INSERT INTO merchant_users (
      id,
      merchant_id,
      email,
      password_hash,
      password_hash_algo,
      role,
      status,
      created_at
    ) VALUES (
      ${sqlLiteral(userId)},
      ${sqlLiteral(merchantId)},
      ${sqlLiteral(String(email || "").trim().toLowerCase())},
      ${sqlLiteral(passwordHash)},
      'pbkdf2_sha512',
      ${sqlLiteral(role)},
      'active',
      ${sqlLiteral(createdAt)}
    );
  `);

  return {
    id: userId,
    merchantId,
    email: String(email || "").trim().toLowerCase(),
    role,
    createdAt
  };
};

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

export const createMerchantOrganization = ({
  merchantName,
  accountName = "Primary Treasury",
  complianceProfile = null
}) => {
  const merchantId = newId();
  const accountId = newId();
  const createdAt = nowIso();
  run(`
    INSERT INTO merchants (
      id,
      name,
      status,
      compliance_profile_json,
      created_at
    ) VALUES (
      ${sqlLiteral(merchantId)},
      ${sqlLiteral(merchantName)},
      'active',
      ${sqlLiteral(complianceProfile ? JSON.stringify(complianceProfile) : null)},
      ${sqlLiteral(createdAt)}
    );
  `);
  run(`
    INSERT INTO merchant_accounts (
      id,
      merchant_id,
      account_name,
      custody_mode,
      status,
      created_at
    ) VALUES (
      ${sqlLiteral(accountId)},
      ${sqlLiteral(merchantId)},
      ${sqlLiteral(accountName)},
      'custodial',
      'active',
      ${sqlLiteral(createdAt)}
    );
  `);

  return {
    merchantId,
    accountId,
    createdAt
  };
};

export const createWalletProfile = ({
  merchantId,
  accountId,
  network,
  address,
  signerProvider = "mpc",
  signerReference
}) => {
  const id = newId();
  const createdAt = nowIso();
  const keyReference = signerReference || `mpc:${merchantId}:${network}`;
  const normalizedAddress = String(keyReference).startsWith("mpc:")
    ? deriveTenantMpcAddress(merchantId, accountId)
    : address;
  const resolvedAddress = normalizeEvmAddress(normalizedAddress);
  if (!resolvedAddress) {
    throw new Error("Invalid wallet address");
  }
  run(`
    INSERT OR IGNORE INTO merchant_account_wallets (
      id,
      merchant_id,
      account_id,
      network,
      asset,
      address,
      key_reference,
      signer_provider,
      signer_reference,
      created_at
    ) VALUES (
      ${sqlLiteral(id)},
      ${sqlLiteral(merchantId)},
      ${sqlLiteral(accountId)},
      ${sqlLiteral(network)},
      'USDC',
      ${sqlLiteral(resolvedAddress)},
      ${sqlLiteral(keyReference)},
      ${sqlLiteral(signerProvider)},
      ${sqlLiteral(keyReference)},
      ${sqlLiteral(createdAt)}
    );
  `);
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

export const createApiKey = ({
  merchantId,
  accountId,
  name = "Default API Key",
  role = "admin",
  createdByUserId = null
}) => {
  const id = newId();
  const createdAt = nowIso();
  const generated = buildApiKey();
  run(`
    INSERT INTO api_keys (
      id,
      merchant_id,
      account_id,
      name,
      key_prefix,
      key_hash,
      role,
      status,
      created_by_user_id,
      created_at,
      updated_at
    ) VALUES (
      ${sqlLiteral(id)},
      ${sqlLiteral(merchantId)},
      ${sqlLiteral(accountId)},
      ${sqlLiteral(name)},
      ${sqlLiteral(generated.prefix)},
      ${sqlLiteral(generated.hash)},
      ${sqlLiteral(role)},
      'active',
      ${sqlLiteral(createdByUserId)},
      ${sqlLiteral(createdAt)},
      ${sqlLiteral(createdAt)}
    );
  `);

  return {
    id,
    merchantId,
    accountId,
    name,
    role,
    token: generated.raw,
    keyPrefix: generated.prefix,
    createdAt
  };
};

export const listApiKeys = (merchantId, accountId) =>
  all(`
    SELECT
      id,
      merchant_id AS merchantId,
      account_id AS accountId,
      name,
      key_prefix AS keyPrefix,
      role,
      status,
      created_by_user_id AS createdByUserId,
      last_used_at AS lastUsedAt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM api_keys
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
    ORDER BY created_at DESC;
  `);

export const revokeActiveConsoleSessionApiKeys = (merchantId, accountId, userId) => {
  run(`
    UPDATE api_keys
    SET status = 'revoked',
        updated_at = ${sqlLiteral(nowIso())}
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
      AND created_by_user_id = ${sqlLiteral(userId)}
      AND status = 'active'
      AND name LIKE 'Console session %';
  `);
};

export const findApiKeyByToken = (token) => {
  const normalized = String(token || "").trim();
  if (!normalized) {
    return null;
  }
  const keyHash = sha256Hex(normalized);
  return one(`
    SELECT
      id,
      merchant_id AS merchantId,
      account_id AS accountId,
      name,
      role,
      status
    FROM api_keys
    WHERE key_hash = ${sqlLiteral(keyHash)}
      AND status = 'active'
    LIMIT 1;
  `);
};

export const touchApiKeyUsed = (id) => {
  const timestamp = nowIso();
  run(`
    UPDATE api_keys
    SET last_used_at = ${sqlLiteral(timestamp)},
        updated_at = ${sqlLiteral(timestamp)}
    WHERE id = ${sqlLiteral(id)};
  `);
};

export const getApiKeyById = (merchantId, accountId, keyId) =>
  one(`
    SELECT
      id,
      merchant_id AS merchantId,
      account_id AS accountId,
      name,
      key_prefix AS keyPrefix,
      role,
      status,
      created_by_user_id AS createdByUserId,
      last_used_at AS lastUsedAt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM api_keys
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
      AND id = ${sqlLiteral(keyId)}
    LIMIT 1;
  `);

export const updateApiKeyMetadata = (merchantId, accountId, keyId, patch = {}) => {
  const updates = [];
  if (patch.name !== undefined) {
    updates.push(`name = ${sqlLiteral(String(patch.name || "").trim())}`);
  }
  if (patch.role !== undefined) {
    updates.push(`role = ${sqlLiteral(String(patch.role || "").trim())}`);
  }
  if (!updates.length) {
    return getApiKeyById(merchantId, accountId, keyId);
  }
  updates.push(`updated_at = ${sqlLiteral(nowIso())}`);
  run(`
    UPDATE api_keys
    SET ${updates.join(", ")}
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
      AND id = ${sqlLiteral(keyId)};
  `);
  return getApiKeyById(merchantId, accountId, keyId);
};

export const revokeApiKeyById = (merchantId, accountId, keyId) => {
  run(`
    UPDATE api_keys
    SET status = 'revoked',
        updated_at = ${sqlLiteral(nowIso())}
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
      AND id = ${sqlLiteral(keyId)};
  `);
  return getApiKeyById(merchantId, accountId, keyId);
};

export const deleteRevokedApiKeyById = (merchantId, accountId, keyId) => {
  const existing = getApiKeyById(merchantId, accountId, keyId);
  if (!existing || existing.status === "active") {
    return null;
  }
  run(`
    DELETE FROM api_keys
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
      AND id = ${sqlLiteral(keyId)}
      AND status != 'active';
  `);
  return {
    id: existing.id,
    deleted: true,
    previousStatus: existing.status
  };
};

export const countActiveApiKeys = (merchantId, accountId) => {
  const row = one(`
    SELECT COUNT(1) AS count
    FROM api_keys
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
      AND status = 'active';
  `);
  return Number(row?.count || 0);
};

export const countActiveApiKeysByRole = (merchantId, accountId, role) => {
  const row = one(`
    SELECT COUNT(1) AS count
    FROM api_keys
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
      AND status = 'active'
      AND role = ${sqlLiteral(role)};
  `);
  return Number(row?.count || 0);
};

export const createWebhookEndpoint = ({ merchantId, accountId, url, signingSecret }) => {
  const id = newId();
  const createdAt = nowIso();
  const normalizedSecret =
    String(signingSecret || "").trim() || `whsec_${randomBytes(24).toString("base64url")}`;
  run(`
    INSERT INTO webhook_endpoints (
      id,
      merchant_id,
      account_id,
      url,
      signing_secret,
      status,
      created_at,
      updated_at
    ) VALUES (
      ${sqlLiteral(id)},
      ${sqlLiteral(merchantId)},
      ${sqlLiteral(accountId)},
      ${sqlLiteral(url)},
      ${sqlLiteral(normalizedSecret)},
      'active',
      ${sqlLiteral(createdAt)},
      ${sqlLiteral(createdAt)}
    );
  `);

  return {
    id,
    merchantId,
    accountId,
    url,
    status: "active",
    createdAt,
    updatedAt: createdAt
  };
};

export const listWebhookEndpoints = (merchantId, accountId) =>
  all(`
    SELECT
      id,
      merchant_id AS merchantId,
      account_id AS accountId,
      url,
      status,
      last_test_status AS lastTestStatus,
      last_test_at AS lastTestAt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM webhook_endpoints
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
    ORDER BY created_at DESC;
  `);

export const getWebhookEndpointById = (merchantId, accountId, webhookId) =>
  one(`
    SELECT
      id,
      merchant_id AS merchantId,
      account_id AS accountId,
      url,
      status,
      last_test_status AS lastTestStatus,
      last_test_at AS lastTestAt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM webhook_endpoints
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
      AND id = ${sqlLiteral(webhookId)}
    LIMIT 1;
  `);

export const listActiveWebhookEndpoints = (merchantId, accountId) =>
  all(`
    SELECT
      id,
      merchant_id AS merchantId,
      account_id AS accountId,
      url,
      signing_secret AS signingSecret,
      status
    FROM webhook_endpoints
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
      AND status = 'active'
    ORDER BY created_at DESC;
  `);

export const markWebhookTestResult = (merchantId, accountId, webhookId, status) => {
  const timestamp = nowIso();
  run(`
    UPDATE webhook_endpoints
    SET
      last_test_status = ${sqlLiteral(status)},
      last_test_at = ${sqlLiteral(timestamp)},
      updated_at = ${sqlLiteral(timestamp)}
    WHERE id = ${sqlLiteral(webhookId)}
      AND merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)};
  `);
};

export const updateWebhookEndpoint = (merchantId, accountId, webhookId, patch) => {
  const existing = getWebhookEndpointById(merchantId, accountId, webhookId);
  if (!existing) {
    return null;
  }
  const now = nowIso();
  const nextUrl = patch.url !== undefined ? patch.url : existing.url;
  const nextStatus = patch.status !== undefined ? patch.status : existing.status;
  run(`
    UPDATE webhook_endpoints
    SET
      url = ${sqlLiteral(nextUrl)},
      status = ${sqlLiteral(nextStatus)},
      updated_at = ${sqlLiteral(now)}
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
      AND id = ${sqlLiteral(webhookId)};
  `);
  return getWebhookEndpointById(merchantId, accountId, webhookId);
};

export const deactivateWebhookEndpoint = (merchantId, accountId, webhookId) =>
  updateWebhookEndpoint(merchantId, accountId, webhookId, { status: "disabled" });

export const deleteWebhookEndpoint = (merchantId, accountId, webhookId) => {
  const existing = getWebhookEndpointById(merchantId, accountId, webhookId);
  if (!existing) {
    return null;
  }
  run(`
    DELETE FROM webhook_endpoints
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
      AND id = ${sqlLiteral(webhookId)};
  `);
  return existing;
};

export const listPayoutAddressBookEntries = (merchantId, accountId) =>
  all(`
    SELECT
      id,
      merchant_id AS merchantId,
      account_id AS accountId,
      label,
      network,
      address,
      last_used_at AS lastUsedAt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM payout_address_book_entries
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
    ORDER BY COALESCE(last_used_at, created_at) DESC, created_at DESC;
  `);

export const getPayoutAddressBookEntryById = (merchantId, accountId, entryId) =>
  one(`
    SELECT
      id,
      merchant_id AS merchantId,
      account_id AS accountId,
      label,
      network,
      address,
      last_used_at AS lastUsedAt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM payout_address_book_entries
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
      AND id = ${sqlLiteral(entryId)}
    LIMIT 1;
  `);

export const findPayoutAddressBookEntryByNetworkAddress = (merchantId, accountId, network, address) =>
  one(`
    SELECT
      id,
      merchant_id AS merchantId,
      account_id AS accountId,
      label,
      network,
      address,
      last_used_at AS lastUsedAt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM payout_address_book_entries
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
      AND network = ${sqlLiteral(String(network || "").trim())}
      AND address = ${sqlLiteral(normalizeEvmAddress(address))}
    LIMIT 1;
  `);

export const upsertPayoutAddressBookEntry = ({
  merchantId,
  accountId,
  label,
  network,
  address
}) => {
  const normalizedNetwork = String(network || "").trim();
  const normalizedAddress = normalizeEvmAddress(address);
  const normalizedLabel = String(label || "").trim();
  const existing = findPayoutAddressBookEntryByNetworkAddress(
    merchantId,
    accountId,
    normalizedNetwork,
    normalizedAddress
  );
  const timestamp = nowIso();

  if (existing) {
    run(`
      UPDATE payout_address_book_entries
      SET
        label = ${sqlLiteral(normalizedLabel)},
        updated_at = ${sqlLiteral(timestamp)}
      WHERE id = ${sqlLiteral(existing.id)};
    `);
    return getPayoutAddressBookEntryById(merchantId, accountId, existing.id);
  }

  const id = newId();
  run(`
    INSERT INTO payout_address_book_entries (
      id,
      merchant_id,
      account_id,
      label,
      network,
      address,
      last_used_at,
      created_at,
      updated_at
    ) VALUES (
      ${sqlLiteral(id)},
      ${sqlLiteral(merchantId)},
      ${sqlLiteral(accountId)},
      ${sqlLiteral(normalizedLabel)},
      ${sqlLiteral(normalizedNetwork)},
      ${sqlLiteral(normalizedAddress)},
      NULL,
      ${sqlLiteral(timestamp)},
      ${sqlLiteral(timestamp)}
    );
  `);
  return getPayoutAddressBookEntryById(merchantId, accountId, id);
};

export const updatePayoutAddressBookEntry = (merchantId, accountId, entryId, patch = {}) => {
  const existing = getPayoutAddressBookEntryById(merchantId, accountId, entryId);
  if (!existing) {
    return null;
  }
  const nextLabel = patch.label !== undefined ? String(patch.label || "").trim() : existing.label;
  const nextNetwork = patch.network !== undefined ? String(patch.network || "").trim() : existing.network;
  const nextAddress = patch.address !== undefined ? normalizeEvmAddress(patch.address) : existing.address;

  run(`
    UPDATE payout_address_book_entries
    SET
      label = ${sqlLiteral(nextLabel)},
      network = ${sqlLiteral(nextNetwork)},
      address = ${sqlLiteral(nextAddress)},
      updated_at = ${sqlLiteral(nowIso())}
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
      AND id = ${sqlLiteral(entryId)};
  `);
  return getPayoutAddressBookEntryById(merchantId, accountId, entryId);
};

export const deletePayoutAddressBookEntry = (merchantId, accountId, entryId) => {
  const existing = getPayoutAddressBookEntryById(merchantId, accountId, entryId);
  if (!existing) {
    return null;
  }
  run(`
    DELETE FROM payout_address_book_entries
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
      AND id = ${sqlLiteral(entryId)};
  `);
  return existing;
};

export const touchPayoutAddressBookEntryUsedByNetworkAddress = (merchantId, accountId, network, address) => {
  const normalizedAddress = normalizeEvmAddress(address);
  if (!normalizedAddress) {
    return null;
  }
  const existing = findPayoutAddressBookEntryByNetworkAddress(
    merchantId,
    accountId,
    String(network || "").trim(),
    normalizedAddress
  );
  if (!existing) {
    return null;
  }
  const timestamp = nowIso();
  run(`
    UPDATE payout_address_book_entries
    SET
      last_used_at = ${sqlLiteral(timestamp)},
      updated_at = ${sqlLiteral(timestamp)}
    WHERE id = ${sqlLiteral(existing.id)};
  `);
  return getPayoutAddressBookEntryById(merchantId, accountId, existing.id);
};

export const insertWebhookDelivery = ({
  webhookId,
  merchantId,
  accountId,
  eventType,
  eventId,
  requestBody,
  responseStatus = null,
  responseBody = null,
  error = null
}) => {
  run(`
    INSERT INTO webhook_deliveries (
      id,
      webhook_id,
      merchant_id,
      account_id,
      event_type,
      event_id,
      request_body,
      response_status,
      response_body,
      error,
      created_at
    ) VALUES (
      ${sqlLiteral(newId())},
      ${sqlLiteral(webhookId)},
      ${sqlLiteral(merchantId)},
      ${sqlLiteral(accountId)},
      ${sqlLiteral(eventType)},
      ${sqlLiteral(eventId)},
      ${sqlLiteral(requestBody)},
      ${responseStatus === null ? "NULL" : sqlLiteral(responseStatus)},
      ${sqlLiteral(responseBody)},
      ${sqlLiteral(error)},
      ${sqlLiteral(nowIso())}
    );
  `);
};

export const upsertChainCatalogRows = (rows) => {
  const now = nowIso();
  (rows || []).forEach((row) => {
    if (!row?.network || !row?.usdcAddress) {
      return;
    }
    const network = String(row.network).trim();
    if (!network) {
      return;
    }
    const rpcEndpoints = Array.isArray(row.rpcEndpoints)
      ? row.rpcEndpoints.filter((url) => typeof url === "string" && /^https?:\/\//.test(url))
      : [];
    run(`
      INSERT INTO chain_catalog (
        network,
        chain_name,
        display_name,
        chain_type,
        usdc_address,
        rpc_endpoints_json,
        explorer_url,
        status,
        source,
        source_updated_at,
        updated_at
      ) VALUES (
        ${sqlLiteral(network)},
        ${sqlLiteral(row.chainName || network)},
        ${sqlLiteral(row.displayName || row.chainName || network)},
        ${sqlLiteral(row.chainType || "evm")},
        ${sqlLiteral(row.usdcAddress)},
        ${sqlLiteral(JSON.stringify(rpcEndpoints))},
        ${sqlLiteral(row.explorerUrl || null)},
        ${sqlLiteral(row.status || "active")},
        ${sqlLiteral(row.source || "circle_bridge_kit")},
        ${sqlLiteral(row.sourceUpdatedAt || now)},
        ${sqlLiteral(now)}
      )
      ON CONFLICT(network) DO UPDATE SET
        chain_name = excluded.chain_name,
        display_name = excluded.display_name,
        chain_type = excluded.chain_type,
        usdc_address = excluded.usdc_address,
        rpc_endpoints_json = excluded.rpc_endpoints_json,
        explorer_url = excluded.explorer_url,
        source = excluded.source,
        source_updated_at = excluded.source_updated_at,
        updated_at = excluded.updated_at;
    `);
  });
};

export const listChainCatalog = () =>
  all(`
    SELECT
      network,
      chain_name AS chainName,
      display_name AS displayName,
      chain_type AS chainType,
      usdc_address AS usdcAddress,
      rpc_endpoints_json AS rpcEndpointsJson,
      explorer_url AS explorerUrl,
      status,
      source,
      source_updated_at AS sourceUpdatedAt,
      updated_at AS updatedAt
    FROM chain_catalog
    ORDER BY network ASC;
  `).map((row) => {
    let rpcEndpoints = [];
    try {
      const parsed = JSON.parse(row.rpcEndpointsJson || "[]");
      if (Array.isArray(parsed)) {
        rpcEndpoints = parsed;
      }
    } catch {
      rpcEndpoints = [];
    }
    return {
      ...row,
      rpcEndpoints
    };
  });

export const getChainCatalogByNetwork = (network) =>
  listChainCatalog().find((row) => row.network === network) || null;

export const setChainCatalogStatus = (network, status) => {
  const normalizedStatus = String(status || "").trim();
  if (!["active", "degraded", "paused"].includes(normalizedStatus)) {
    throw new Error("status must be active, degraded, or paused");
  }
  run(`
    UPDATE chain_catalog
    SET
      status = ${sqlLiteral(normalizedStatus)},
      updated_at = ${sqlLiteral(nowIso())}
    WHERE network = ${sqlLiteral(network)};
  `);
};

export const getChainCatalogRuntimeMaps = () => {
  const rows = listChainCatalog().filter((row) => row.status !== "paused");
  const rpcUrlsByNetwork = {};
  const rpcByNetwork = {};
  const usdcTokenByNetwork = {};
  const usdcAssetAllowlist = new Set(["USDC"]);

  rows.forEach((row) => {
    const urls = (row.rpcEndpoints || []).filter((item) => typeof item === "string");
    if (urls.length > 0) {
      rpcUrlsByNetwork[row.network] = urls;
      rpcByNetwork[row.network] = urls[0];
    }
    usdcTokenByNetwork[row.network] = row.usdcAddress;
    usdcAssetAllowlist.add(String(row.usdcAddress || "").toLowerCase());
  });

  return {
    chains: rows,
    rpcUrlsByNetwork,
    rpcByNetwork,
    usdcTokenByNetwork,
    usdcAssetAllowlist
  };
};

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
  if (String(keyReference || "").startsWith("mpc:")) {
    return deriveTenantMpcPrivateKey(merchantId, accountId);
  }
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

export const getApiProductByApiId = (merchantId, accountId, apiId) => {
  const normalizedApiId = String(apiId || "").trim();
  if (!normalizedApiId) {
    return null;
  }
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
      AND lower(api_id) = lower(${sqlLiteral(normalizedApiId)})
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

export const deleteApiProduct = (merchantId, accountId, apiProductId) => {
  const existing = getApiProductById(merchantId, accountId, apiProductId);
  if (!existing) {
    return null;
  }
  run(`
    DELETE FROM api_products
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
      AND id = ${sqlLiteral(apiProductId)};
  `);
  return existing;
};

export const getPolicy = (merchantId, accountId) => {
  const row = one(`
    SELECT
      preferred_network AS preferredNetwork,
      preferred_asset AS preferredAsset,
      treasury_mode AS treasuryMode,
      private_home_network AS privateHomeNetwork,
      privacy_enabled_at AS privacyEnabledAt,
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
    treasuryMode: normalizeTreasuryMode(row.treasuryMode),
    autoBridgeEnabled: Boolean(row.autoBridgeEnabled)
  };
};

export const upsertPolicy = (merchantId, accountId, policy) => {
  const updatedAt = nowIso();
  const treasuryMode = normalizeTreasuryMode(policy.treasuryMode);
  const privateHomeNetwork =
    treasuryMode === "private" && String(policy.privateHomeNetwork || "").trim()
      ? String(policy.privateHomeNetwork).trim()
      : null;
  const privacyEnabledAt =
    treasuryMode === "private" ? String(policy.privacyEnabledAt || updatedAt).trim() || updatedAt : null;
  run(`
    INSERT OR REPLACE INTO treasury_policy (
      merchant_id,
      account_id,
      preferred_network,
      preferred_asset,
      treasury_mode,
      private_home_network,
      privacy_enabled_at,
      auto_bridge_enabled,
      updated_at
    ) VALUES (
      ${sqlLiteral(merchantId)},
      ${sqlLiteral(accountId)},
      ${sqlLiteral(policy.preferredNetwork)},
      'USDC',
      ${sqlLiteral(treasuryMode)},
      ${sqlLiteral(privateHomeNetwork)},
      ${sqlLiteral(privacyEnabledAt)},
      ${policy.autoBridgeEnabled ? 1 : 0},
      ${sqlLiteral(updatedAt)}
    );
  `);
  return getPolicy(merchantId, accountId);
};

export const getPaymentRequirementContext = (paymentContextId) => {
  const row = one(`
    SELECT
      id,
      payment_context_id AS paymentContextId,
      merchant_id AS merchantId,
      account_id AS accountId,
      api_product_id AS apiProductId,
      treasury_mode AS treasuryMode,
      privacy_coverage_mode AS privacyCoverageMode,
      private_home_network AS privateHomeNetwork,
      scheme,
      source_network AS sourceNetwork,
      destination_network AS destinationNetwork,
      asset,
      amount,
      public_pay_to AS publicPayTo,
      settlement_id AS settlementId,
      status,
      issued_at AS issuedAt,
      expires_at AS expiresAt,
      settled_at AS settledAt,
      consumed_at AS consumedAt,
      metadata_json AS metadataJson
    FROM payment_requirement_contexts
    WHERE payment_context_id = ${sqlLiteral(String(paymentContextId || "").trim())}
    LIMIT 1;
  `);

  if (!row) {
    return null;
  }

  let metadata = null;
  if (row.metadataJson) {
    try {
      metadata = JSON.parse(String(row.metadataJson));
    } catch {
      metadata = null;
    }
  }

  return {
    ...row,
    treasuryMode: normalizeTreasuryMode(row.treasuryMode),
    metadata
  };
};

export const createPaymentRequirementContext = (input) => {
  const id = newId();
  const paymentContextId =
    String(input.paymentContextId || "").trim() || `pctx_${randomBytes(16).toString("hex")}`;
  const issuedAt = String(input.issuedAt || nowIso()).trim();
  const expiresAt = String(input.expiresAt || addHoursIso(PAYMENT_CONTEXT_TTL_HOURS)).trim();
  const metadataJson =
    input.metadata && typeof input.metadata === "object" ? JSON.stringify(input.metadata) : null;

  run(`
    INSERT INTO payment_requirement_contexts (
      id,
      payment_context_id,
      merchant_id,
      account_id,
      api_product_id,
      treasury_mode,
      privacy_coverage_mode,
      private_home_network,
      scheme,
      source_network,
      destination_network,
      asset,
      amount,
      public_pay_to,
      settlement_id,
      status,
      issued_at,
      expires_at,
      settled_at,
      consumed_at,
      metadata_json
    ) VALUES (
      ${sqlLiteral(id)},
      ${sqlLiteral(paymentContextId)},
      ${sqlLiteral(input.merchantId)},
      ${sqlLiteral(input.accountId)},
      ${sqlLiteral(input.apiProductId || null)},
      ${sqlLiteral(normalizeTreasuryMode(input.treasuryMode))},
      ${sqlLiteral(input.privacyCoverageMode || null)},
      ${sqlLiteral(input.privateHomeNetwork || null)},
      ${sqlLiteral(input.scheme)},
      ${sqlLiteral(input.sourceNetwork)},
      ${sqlLiteral(input.destinationNetwork || null)},
      ${sqlLiteral(input.asset)},
      ${sqlLiteral(input.amount)},
      ${sqlLiteral(normalizePaymentContextPayTo(input.publicPayTo))},
      NULL,
      'issued',
      ${sqlLiteral(issuedAt)},
      ${sqlLiteral(expiresAt)},
      NULL,
      NULL,
      ${sqlLiteral(metadataJson)}
    );
  `);

  return getPaymentRequirementContext(paymentContextId);
};

export const resolvePaymentRequirementContextForSettlement = ({
  paymentContextId,
  settlementId,
  scheme,
  sourceNetwork,
  asset,
  amount,
  publicPayTo
}) => {
  const context = getPaymentRequirementContext(paymentContextId);
  if (!context) {
    return {
      ok: false,
      code: "not_found",
      error: "paymentContextId was not found"
    };
  }

  if (
    context.status === "expired" ||
    context.status === "failed" ||
    (context.status === "consumed" && context.settlementId !== settlementId)
  ) {
    return {
      ok: false,
      code: "unusable",
      error: `paymentContextId is not usable in status=${context.status}`
    };
  }

  const expiresAtMs = new Date(context.expiresAt).getTime();
  if (Number.isFinite(expiresAtMs) && expiresAtMs < Date.now() && !context.settlementId) {
    run(`
      UPDATE payment_requirement_contexts
      SET status = 'expired'
      WHERE payment_context_id = ${sqlLiteral(context.paymentContextId)};
    `);
    return {
      ok: false,
      code: "expired",
      error: "paymentContextId has expired"
    };
  }

  if (context.settlementId && context.settlementId === settlementId) {
    return {
      ok: true,
      context
    };
  }

  const expectedValues = {
    scheme: String(context.scheme || "").trim(),
    sourceNetwork: String(context.sourceNetwork || "").trim(),
    asset: normalizePaymentContextAsset(context.asset),
    amount: String(context.amount || "").trim(),
    publicPayTo: normalizePaymentContextPayTo(context.publicPayTo)
  };
  const actualValues = {
    scheme: String(scheme || "").trim(),
    sourceNetwork: String(sourceNetwork || "").trim(),
    asset: normalizePaymentContextAsset(asset),
    amount: String(amount || "").trim(),
    publicPayTo: normalizePaymentContextPayTo(publicPayTo)
  };

  for (const field of Object.keys(expectedValues)) {
    if (expectedValues[field] !== actualValues[field]) {
      return {
        ok: false,
        code: "mismatch",
        error: `paymentContextId did not match field=${field}`
      };
    }
  }

  if (context.settlementId && context.settlementId !== settlementId) {
    return {
      ok: false,
      code: "reused",
      error: "paymentContextId is already bound to another settlement"
    };
  }

  const settledAt = nowIso();
  run(`
    UPDATE payment_requirement_contexts
    SET settlement_id = ${sqlLiteral(settlementId)},
        status = CASE
          WHEN status = 'consumed' THEN 'consumed'
          ELSE 'settled'
        END,
        settled_at = COALESCE(settled_at, ${sqlLiteral(settledAt)})
    WHERE payment_context_id = ${sqlLiteral(context.paymentContextId)}
      AND (settlement_id IS NULL OR settlement_id = ${sqlLiteral(settlementId)});
  `);

  const resolvedContext = getPaymentRequirementContext(context.paymentContextId);
  if (!resolvedContext) {
    return {
      ok: false,
      code: "not_found",
      error: "paymentContextId was not found after settlement binding"
    };
  }
  if (resolvedContext.settlementId && resolvedContext.settlementId !== settlementId) {
    return {
      ok: false,
      code: "reused",
      error: "paymentContextId is already bound to another settlement"
    };
  }

  return {
    ok: true,
    context: resolvedContext
  };
};

export const markPaymentRequirementContextConsumed = (paymentContextId, settlementId) => {
  const context = getPaymentRequirementContext(paymentContextId);
  if (!context) {
    return null;
  }
  const consumedAt = nowIso();
  run(`
    UPDATE payment_requirement_contexts
    SET status = 'consumed',
        consumed_at = COALESCE(consumed_at, ${sqlLiteral(consumedAt)}),
        settled_at = COALESCE(settled_at, ${sqlLiteral(consumedAt)}),
        settlement_id = COALESCE(settlement_id, ${sqlLiteral(settlementId || null)})
    WHERE payment_context_id = ${sqlLiteral(context.paymentContextId)}
      AND (
        settlement_id IS NULL
        OR settlement_id = ${sqlLiteral(settlementId || null)}
      );
  `);
  return getPaymentRequirementContext(paymentContextId);
};

export const getPrivateAccount = ({
  merchantId,
  accountId,
  provider = "unlink",
  environment,
  role = "merchant"
}) =>
  one(`
    SELECT
      id,
      merchant_id AS merchantId,
      account_id AS accountId,
      provider,
      environment,
      network,
      role,
      unlink_address AS unlinkAddress,
      key_reference AS keyReference,
      status,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM private_accounts
    WHERE merchant_id ${merchantId ? `= ${sqlLiteral(merchantId)}` : "IS NULL"}
      AND account_id ${accountId ? `= ${sqlLiteral(accountId)}` : "IS NULL"}
      AND provider = ${sqlLiteral(provider)}
      AND environment = ${sqlLiteral(environment)}
      AND role = ${sqlLiteral(role)}
    ORDER BY updated_at DESC
    LIMIT 1;
  `);

export const upsertPrivateAccount = (input) => {
  const existing = getPrivateAccount(input) || null;
  const id = existing?.id || newId();
  const createdAt = existing?.createdAt || nowIso();
  const updatedAt = nowIso();

  run(`
    INSERT OR REPLACE INTO private_accounts (
      id,
      merchant_id,
      account_id,
      provider,
      environment,
      network,
      role,
      unlink_address,
      key_reference,
      status,
      created_at,
      updated_at
    ) VALUES (
      ${sqlLiteral(id)},
      ${sqlLiteral(input.merchantId || null)},
      ${sqlLiteral(input.accountId || null)},
      ${sqlLiteral(input.provider || "unlink")},
      ${sqlLiteral(input.environment)},
      ${sqlLiteral(input.network)},
      ${sqlLiteral(input.role || "merchant")},
      ${sqlLiteral(input.unlinkAddress || null)},
      ${sqlLiteral(input.keyReference || null)},
      ${sqlLiteral(input.status || "active")},
      ${sqlLiteral(createdAt)},
      ${sqlLiteral(updatedAt)}
    );
  `);

  return getPrivateAccount({
    merchantId: input.merchantId || null,
    accountId: input.accountId || null,
    provider: input.provider || "unlink",
    environment: input.environment,
    role: input.role || "merchant"
  });
};

const parsePrivateLedgerEntryRow = (row) => {
  if (!row) {
    return null;
  }

  let metadata = null;
  if (row.metadataJson) {
    try {
      metadata = JSON.parse(String(row.metadataJson));
    } catch {
      metadata = null;
    }
  }

  return {
    ...row,
    metadata
  };
};

export const getPrivateLedgerEntryByIdempotencyKey = (idempotencyKey) =>
  parsePrivateLedgerEntryRow(
    one(`
      SELECT
        id,
        merchant_id AS merchantId,
        account_id AS accountId,
        provider,
        environment,
        network,
        asset,
        entry_type AS entryType,
        direction,
        amount,
        available_delta AS availableDelta,
        pending_sweep_delta AS pendingSweepDelta,
        pending_withdrawal_delta AS pendingWithdrawalDelta,
        reference_type AS referenceType,
        reference_id AS referenceId,
        idempotency_key AS idempotencyKey,
        metadata_json AS metadataJson,
        created_at AS createdAt
      FROM private_ledger_entries
      WHERE idempotency_key = ${sqlLiteral(String(idempotencyKey || "").trim())}
      LIMIT 1;
    `)
  );

export const insertPrivateLedgerEntry = (input) => {
  const idempotencyKey = String(input.idempotencyKey || "").trim();
  if (!idempotencyKey) {
    throw new Error("idempotencyKey is required");
  }

  const existing = getPrivateLedgerEntryByIdempotencyKey(idempotencyKey);
  if (existing) {
    return existing;
  }

  const id = String(input.id || newId()).trim();
  const createdAt = String(input.createdAt || nowIso()).trim();
  const metadataJson =
    input.metadata && typeof input.metadata === "object" ? JSON.stringify(input.metadata) : null;

  run(`
    INSERT OR IGNORE INTO private_ledger_entries (
      id,
      merchant_id,
      account_id,
      provider,
      environment,
      network,
      asset,
      entry_type,
      direction,
      amount,
      available_delta,
      pending_sweep_delta,
      pending_withdrawal_delta,
      reference_type,
      reference_id,
      idempotency_key,
      metadata_json,
      created_at
    ) VALUES (
      ${sqlLiteral(id)},
      ${sqlLiteral(input.merchantId)},
      ${sqlLiteral(input.accountId)},
      ${sqlLiteral(input.provider || "unlink")},
      ${sqlLiteral(input.environment)},
      ${sqlLiteral(input.network)},
      ${sqlLiteral(input.asset || "USDC")},
      ${sqlLiteral(input.entryType)},
      ${sqlLiteral(input.direction)},
      ${sqlLiteral(input.amount)},
      ${sqlLiteral(input.availableDelta || "0")},
      ${sqlLiteral(input.pendingSweepDelta || "0")},
      ${sqlLiteral(input.pendingWithdrawalDelta || "0")},
      ${sqlLiteral(input.referenceType)},
      ${sqlLiteral(input.referenceId)},
      ${sqlLiteral(idempotencyKey)},
      ${sqlLiteral(metadataJson)},
      ${sqlLiteral(createdAt)}
    );
  `);

  return getPrivateLedgerEntryByIdempotencyKey(idempotencyKey);
};

export const getPrivateLedgerWorkflowBalances = (merchantId, accountId) => {
  const rows = all(`
    SELECT
      network,
      available_delta AS availableDelta,
      pending_sweep_delta AS pendingSweepDelta,
      pending_withdrawal_delta AS pendingWithdrawalDelta
    FROM private_ledger_entries
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
      AND asset = 'USDC'
    ORDER BY created_at ASC;
  `);

  const parseAmount = (value) => {
    try {
      return BigInt(String(value || "0"));
    } catch {
      return 0n;
    }
  };

  const totals = new Map();
  rows.forEach((row) => {
    const network = String(row.network || "").trim();
    if (!network) {
      return;
    }
    const current = totals.get(network) || {
      network,
      availableAmount: 0n,
      pendingSweepAmount: 0n,
      pendingWithdrawalAmount: 0n
    };
    current.availableAmount += parseAmount(row.availableDelta);
    current.pendingSweepAmount += parseAmount(row.pendingSweepDelta);
    current.pendingWithdrawalAmount += parseAmount(row.pendingWithdrawalDelta);
    totals.set(network, current);
  });

  return [...totals.values()]
    .map((row) => ({
      network: row.network,
      availableAmount: row.availableAmount.toString(),
      pendingSweepAmount: row.pendingSweepAmount.toString(),
      pendingWithdrawalAmount: row.pendingWithdrawalAmount.toString()
    }))
    .sort((left, right) => left.network.localeCompare(right.network));
};

export const getPrivateIntakeCommittedBalances = (merchantId, accountId) => {
  const rows = all(`
    SELECT
      network,
      amount
    FROM private_ledger_entries
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
      AND asset = 'USDC'
      AND entry_type = 'payment.settled_public_intake'
    ORDER BY created_at ASC;
  `);

  const totals = new Map();
  rows.forEach((row) => {
    const network = String(row.network || "").trim();
    if (!network) {
      return;
    }
    try {
      const amount = BigInt(String(row.amount || "0"));
      totals.set(network, (totals.get(network) || 0n) + amount);
    } catch {
      // ignore invalid historical row
    }
  });

  return [...totals.entries()]
    .map(([network, totalAmount]) => ({
      network,
      totalAmount: totalAmount.toString()
    }))
    .sort((left, right) => left.network.localeCompare(right.network));
};

export const listPendingPrivateSweepCandidates = (limit = 20) => {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Number(limit), 200)) : 20;
  return all(`
    SELECT
      id,
      merchant_id AS merchantId,
      account_id AS accountId,
      provider,
      environment,
      network,
      asset,
      entry_type AS entryType,
      direction,
      amount,
      available_delta AS availableDelta,
      pending_sweep_delta AS pendingSweepDelta,
      pending_withdrawal_delta AS pendingWithdrawalDelta,
      reference_type AS referenceType,
      reference_id AS referenceId,
      idempotency_key AS idempotencyKey,
      metadata_json AS metadataJson,
      created_at AS createdAt
    FROM private_ledger_entries entry
    WHERE entry.entry_type = 'payment.settled_public_intake'
      AND entry.asset = 'USDC'
      AND NOT EXISTS (
        SELECT 1
        FROM private_ledger_entries credit
        WHERE credit.reference_type = entry.reference_type
          AND credit.reference_id = entry.reference_id
          AND credit.entry_type = 'merchant.private_credit'
      )
    ORDER BY entry.created_at ASC
    LIMIT ${safeLimit};
  `).map((row) => parsePrivateLedgerEntryRow(row));
};

const getOmnibusSweepByIdempotencyKey = (idempotencyKey) =>
  one(`
    SELECT
      id,
      merchant_id AS merchantId,
      account_id AS accountId,
      provider,
      environment,
      network,
      asset,
      settlement_id AS settlementId,
      payment_context_id AS paymentContextId,
      amount,
      omnibus_account_id AS omnibusAccountId,
      provider_tx_id AS providerTxId,
      provider_tx_hash AS providerTxHash,
      status,
      fail_reason AS failReason,
      idempotency_key AS idempotencyKey,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM omnibus_sweeps
    WHERE idempotency_key = ${sqlLiteral(String(idempotencyKey || "").trim())}
    LIMIT 1;
  `);

export const upsertOmnibusSweep = (input) => {
  const idempotencyKey = String(input.idempotencyKey || "").trim();
  if (!idempotencyKey) {
    throw new Error("idempotencyKey is required");
  }
  const existing = getOmnibusSweepByIdempotencyKey(idempotencyKey);
  const id = existing?.id || String(input.id || newId()).trim();
  const createdAt = existing?.createdAt || String(input.createdAt || nowIso()).trim();
  const updatedAt = nowIso();

  run(`
    INSERT OR REPLACE INTO omnibus_sweeps (
      id,
      merchant_id,
      account_id,
      provider,
      environment,
      network,
      asset,
      settlement_id,
      payment_context_id,
      amount,
      omnibus_account_id,
      provider_tx_id,
      provider_tx_hash,
      status,
      fail_reason,
      idempotency_key,
      created_at,
      updated_at
    ) VALUES (
      ${sqlLiteral(id)},
      ${sqlLiteral(input.merchantId)},
      ${sqlLiteral(input.accountId)},
      ${sqlLiteral(input.provider || "unlink")},
      ${sqlLiteral(input.environment)},
      ${sqlLiteral(input.network)},
      ${sqlLiteral(input.asset || "USDC")},
      ${sqlLiteral(input.settlementId)},
      ${sqlLiteral(input.paymentContextId || null)},
      ${sqlLiteral(input.amount)},
      ${sqlLiteral(input.omnibusAccountId || null)},
      ${sqlLiteral(input.providerTxId || null)},
      ${sqlLiteral(input.providerTxHash || null)},
      ${sqlLiteral(input.status || "submitted")},
      ${sqlLiteral(input.failReason || null)},
      ${sqlLiteral(idempotencyKey)},
      ${sqlLiteral(createdAt)},
      ${sqlLiteral(updatedAt)}
    );
  `);

  return getOmnibusSweepByIdempotencyKey(idempotencyKey);
};

const getPrivateTransferByIdempotencyKey = (idempotencyKey) =>
  one(`
    SELECT
      id,
      merchant_id AS merchantId,
      account_id AS accountId,
      provider,
      environment,
      network,
      asset,
      settlement_id AS settlementId,
      payment_context_id AS paymentContextId,
      amount,
      from_account_id AS fromAccountId,
      to_account_id AS toAccountId,
      to_unlink_address AS toUnlinkAddress,
      provider_tx_id AS providerTxId,
      provider_tx_hash AS providerTxHash,
      status,
      fail_reason AS failReason,
      idempotency_key AS idempotencyKey,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM private_transfers
    WHERE idempotency_key = ${sqlLiteral(String(idempotencyKey || "").trim())}
    LIMIT 1;
  `);

export const upsertPrivateTransfer = (input) => {
  const idempotencyKey = String(input.idempotencyKey || "").trim();
  if (!idempotencyKey) {
    throw new Error("idempotencyKey is required");
  }
  const existing = getPrivateTransferByIdempotencyKey(idempotencyKey);
  const id = existing?.id || String(input.id || newId()).trim();
  const createdAt = existing?.createdAt || String(input.createdAt || nowIso()).trim();
  const updatedAt = nowIso();

  run(`
    INSERT OR REPLACE INTO private_transfers (
      id,
      merchant_id,
      account_id,
      provider,
      environment,
      network,
      asset,
      settlement_id,
      payment_context_id,
      amount,
      from_account_id,
      to_account_id,
      to_unlink_address,
      provider_tx_id,
      provider_tx_hash,
      status,
      fail_reason,
      idempotency_key,
      created_at,
      updated_at
    ) VALUES (
      ${sqlLiteral(id)},
      ${sqlLiteral(input.merchantId)},
      ${sqlLiteral(input.accountId)},
      ${sqlLiteral(input.provider || "unlink")},
      ${sqlLiteral(input.environment)},
      ${sqlLiteral(input.network)},
      ${sqlLiteral(input.asset || "USDC")},
      ${sqlLiteral(input.settlementId)},
      ${sqlLiteral(input.paymentContextId || null)},
      ${sqlLiteral(input.amount)},
      ${sqlLiteral(input.fromAccountId || null)},
      ${sqlLiteral(input.toAccountId || null)},
      ${sqlLiteral(input.toUnlinkAddress || null)},
      ${sqlLiteral(input.providerTxId || null)},
      ${sqlLiteral(input.providerTxHash || null)},
      ${sqlLiteral(input.status || "submitted")},
      ${sqlLiteral(input.failReason || null)},
      ${sqlLiteral(idempotencyKey)},
      ${sqlLiteral(createdAt)},
      ${sqlLiteral(updatedAt)}
    );
  `);

  return getPrivateTransferByIdempotencyKey(idempotencyKey);
};

export const getLatestPrivateBalanceSnapshot = ({
  merchantId,
  accountId,
  network,
  asset = "USDC",
  provider = "unlink"
}) =>
  one(`
    SELECT
      id,
      merchant_id AS merchantId,
      account_id AS accountId,
      provider,
      environment,
      network,
      asset,
      amount,
      freshness,
      recorded_at AS recordedAt,
      source_updated_at AS sourceUpdatedAt
    FROM private_balance_snapshots
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
      AND network = ${sqlLiteral(network)}
      AND asset = ${sqlLiteral(asset)}
      AND provider = ${sqlLiteral(provider)}
    ORDER BY recorded_at DESC
    LIMIT 1;
  `);

export const insertPrivateBalanceSnapshot = (input) => {
  const id = newId();
  const recordedAt = String(input.recordedAt || nowIso()).trim();
  run(`
    INSERT INTO private_balance_snapshots (
      id,
      merchant_id,
      account_id,
      provider,
      environment,
      network,
      asset,
      amount,
      freshness,
      recorded_at,
      source_updated_at
    ) VALUES (
      ${sqlLiteral(id)},
      ${sqlLiteral(input.merchantId)},
      ${sqlLiteral(input.accountId)},
      ${sqlLiteral(input.provider || "unlink")},
      ${sqlLiteral(input.environment)},
      ${sqlLiteral(input.network)},
      ${sqlLiteral(input.asset || "USDC")},
      ${sqlLiteral(input.amount)},
      ${sqlLiteral(input.freshness || "cached")},
      ${sqlLiteral(recordedAt)},
      ${sqlLiteral(input.sourceUpdatedAt || null)}
    );
  `);

  return getLatestPrivateBalanceSnapshot({
    merchantId: input.merchantId,
    accountId: input.accountId,
    network: input.network,
    asset: input.asset || "USDC",
    provider: input.provider || "unlink"
  });
};

export const getPendingPrivateIntakeBalances = (merchantId, accountId) => {
  return getPrivateLedgerWorkflowBalances(merchantId, accountId)
    .map((row) => {
      try {
        return {
          network: row.network,
          totalAmount: BigInt(String(row.pendingSweepAmount || "0"))
        };
      } catch {
        return {
          network: row.network,
          totalAmount: 0n
        };
      }
    })
    .filter((row) => row.totalAmount > 0n)
    .map((row) => ({
      network: row.network,
      totalAmount: row.totalAmount.toString()
    }));
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
      fail_reason,
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
      ${sqlLiteral(event.failReason || null)},
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
  const toBigIntSafe = (value) => {
    try {
      return BigInt(String(value || "0"));
    } catch {
      return 0n;
    }
  };

  const add = (network, delta) => {
    const current = aggregated.get(network) || 0n;
    aggregated.set(network, current + delta);
  };

  latestSettlementRows.forEach((row) => {
    if (row.status === "failed" || row.status === "bridge_pending") {
      return;
    }

    const amount = toBigIntSafe(row.amount);
    if (amount <= 0n) {
      return;
    }
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
    const amount = toBigIntSafe(row.amount);
    if (amount <= 0n) {
      return;
    }
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
    const amount = toBigIntSafe(row.amount);
    if (amount <= 0n) {
      return;
    }
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

export const acquireTenantMutationDbLock = (lockKey, leaseMs = 120000) => {
  const ownerToken = `lock_${randomUUID()}`;
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + Math.max(1000, Number(leaseMs) || 120000)).toISOString();

  run(`
    INSERT INTO tenant_mutation_locks (
      lock_key,
      owner_token,
      expires_at,
      created_at,
      updated_at
    ) VALUES (
      ${sqlLiteral(lockKey)},
      ${sqlLiteral(ownerToken)},
      ${sqlLiteral(expiresAt)},
      ${sqlLiteral(now)},
      ${sqlLiteral(now)}
    )
    ON CONFLICT(lock_key) DO UPDATE SET
      owner_token = excluded.owner_token,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
    WHERE tenant_mutation_locks.expires_at <= excluded.updated_at;
  `);

  const row = one(`
    SELECT owner_token AS ownerToken, expires_at AS expiresAt
    FROM tenant_mutation_locks
    WHERE lock_key = ${sqlLiteral(lockKey)}
    LIMIT 1;
  `);

  if (!row || row.ownerToken !== ownerToken) {
    return null;
  }
  return {
    lockKey,
    ownerToken,
    expiresAt: String(row.expiresAt || expiresAt)
  };
};

export const releaseTenantMutationDbLock = (lockHandle) => {
  if (!lockHandle || !lockHandle.lockKey || !lockHandle.ownerToken) {
    return;
  }
  run(`
    DELETE FROM tenant_mutation_locks
    WHERE lock_key = ${sqlLiteral(lockHandle.lockKey)}
      AND owner_token = ${sqlLiteral(lockHandle.ownerToken)};
  `);
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
      fail_reason,
      tx_hash,
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
      NULL,
      NULL,
      ${sqlLiteral(createdAt)},
      ${sqlLiteral(createdAt)}
    );
  `);
  return id;
};

export const updatePayoutStatus = (id, status, details = {}) => {
  const failReason =
    details && Object.prototype.hasOwnProperty.call(details, "failReason")
      ? details.failReason
      : undefined;
  const txHash =
    details && Object.prototype.hasOwnProperty.call(details, "txHash")
      ? details.txHash
      : undefined;
  const updates = [
    `status = ${sqlLiteral(status)}`,
    `updated_at = ${sqlLiteral(nowIso())}`
  ];
  if (failReason !== undefined) {
    updates.push(`fail_reason = ${sqlLiteral(failReason)}`);
  }
  if (txHash !== undefined) {
    updates.push(`tx_hash = ${sqlLiteral(txHash)}`);
  }
  run(`
    UPDATE treasury_payout_requests
    SET
      ${updates.join(",\n      ")}
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
      fail_reason AS failReason,
      tx_hash AS txHash,
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

const buildTimelineUnionSql = (merchantId, accountId) => `
  SELECT
    'settlement' AS itemType,
    event_id AS id,
    settlement_id AS settlementId,
    api_id AS apiId,
    api_route AS apiRoute,
    api_name AS apiName,
    source_network AS sourceNetwork,
    destination_network AS destinationNetwork,
    NULL AS destinationAddress,
    asset,
    amount,
    status,
    fail_reason AS failReason,
    tx_hash AS txHash,
    source_tx_hash AS sourceTxHash,
    bridge_tx_hash AS bridgeTxHash,
    destination_tx_hash AS destinationTxHash,
    block_number AS blockNumber,
    log_index AS logIndex,
    confirmations,
    NULL AS providerTxId,
    NULL AS privacyStage,
    created_at AS createdAt
  FROM treasury_settlement_events
  WHERE merchant_id = ${sqlLiteral(merchantId)}
    AND account_id = ${sqlLiteral(accountId)}

  UNION ALL

  SELECT
    'consolidation' AS itemType,
    id,
    id AS settlementId,
    NULL AS apiId,
    NULL AS apiRoute,
    NULL AS apiName,
    source_network AS sourceNetwork,
    destination_network AS destinationNetwork,
    NULL AS destinationAddress,
    asset,
    amount,
    status,
    fail_reason AS failReason,
    tx_hash AS txHash,
    source_tx_hash AS sourceTxHash,
    bridge_tx_hash AS bridgeTxHash,
    destination_tx_hash AS destinationTxHash,
    NULL AS blockNumber,
    NULL AS logIndex,
    NULL AS confirmations,
    NULL AS providerTxId,
    NULL AS privacyStage,
    created_at AS createdAt
  FROM treasury_consolidations
  WHERE merchant_id = ${sqlLiteral(merchantId)}
    AND account_id = ${sqlLiteral(accountId)}

  UNION ALL

  SELECT
    'payout' AS itemType,
    id,
    id AS settlementId,
    NULL AS apiId,
    NULL AS apiRoute,
    NULL AS apiName,
    network AS sourceNetwork,
    NULL AS destinationNetwork,
    destination_address AS destinationAddress,
    asset,
    amount,
    status,
    fail_reason AS failReason,
    tx_hash AS txHash,
    tx_hash AS sourceTxHash,
    NULL AS bridgeTxHash,
    NULL AS destinationTxHash,
    NULL AS blockNumber,
    NULL AS logIndex,
    NULL AS confirmations,
    NULL AS providerTxId,
    NULL AS privacyStage,
    created_at AS createdAt
  FROM treasury_payout_requests
  WHERE merchant_id = ${sqlLiteral(merchantId)}
    AND account_id = ${sqlLiteral(accountId)}

  UNION ALL

  SELECT
    'private_sweep' AS itemType,
    id,
    settlement_id AS settlementId,
    NULL AS apiId,
    NULL AS apiRoute,
    NULL AS apiName,
    network AS sourceNetwork,
    NULL AS destinationNetwork,
    NULL AS destinationAddress,
    asset,
    amount,
    status,
    fail_reason AS failReason,
    provider_tx_hash AS txHash,
    provider_tx_hash AS sourceTxHash,
    NULL AS bridgeTxHash,
    NULL AS destinationTxHash,
    NULL AS blockNumber,
    NULL AS logIndex,
    NULL AS confirmations,
    provider_tx_id AS providerTxId,
    'private_sweep' AS privacyStage,
    created_at AS createdAt
  FROM omnibus_sweeps
  WHERE merchant_id = ${sqlLiteral(merchantId)}
    AND account_id = ${sqlLiteral(accountId)}

  UNION ALL

  SELECT
    'private_transfer' AS itemType,
    id,
    settlement_id AS settlementId,
    NULL AS apiId,
    NULL AS apiRoute,
    NULL AS apiName,
    network AS sourceNetwork,
    NULL AS destinationNetwork,
    to_unlink_address AS destinationAddress,
    asset,
    amount,
    status,
    fail_reason AS failReason,
    provider_tx_hash AS txHash,
    provider_tx_hash AS sourceTxHash,
    NULL AS bridgeTxHash,
    NULL AS destinationTxHash,
    NULL AS blockNumber,
    NULL AS logIndex,
    NULL AS confirmations,
    provider_tx_id AS providerTxId,
    'private_transfer' AS privacyStage,
    created_at AS createdAt
  FROM private_transfers
  WHERE merchant_id = ${sqlLiteral(merchantId)}
    AND account_id = ${sqlLiteral(accountId)}
`;

const enrichTimelinePrivacyStages = (merchantId, accountId, items) => {
  if (!Array.isArray(items) || items.length === 0) {
    return items;
  }

  const settlementIds = [
    ...new Set(
      items
        .map((item) => String(item?.settlementId || "").trim())
        .filter(Boolean)
    )
  ];
  if (!settlementIds.length) {
    return items;
  }

  const intakeRows = all(`
    SELECT reference_id AS settlementId
    FROM private_ledger_entries
    WHERE merchant_id = ${sqlLiteral(merchantId)}
      AND account_id = ${sqlLiteral(accountId)}
      AND entry_type = 'payment.settled_public_intake'
      AND reference_id IN (${settlementIds.map((value) => sqlLiteral(value)).join(", ")});
  `);
  const intakeSettlementIds = new Set(
    intakeRows.map((row) => String(row.settlementId || "").trim()).filter(Boolean)
  );

  return items.map((item) => {
    if (item.itemType !== "settlement" || !intakeSettlementIds.has(String(item.settlementId || "").trim())) {
      return item;
    }
    return {
      ...item,
      privacyStage: "public_intake"
    };
  });
};

export const queryTimeline = (
  merchantId,
  accountId,
  { page = 1, pageSize = 20, itemTypes = [], createdFrom = "", createdTo = "" } = {}
) => {
  const safePageSize = Number.isFinite(pageSize) ? Math.max(1, Math.min(pageSize, 100)) : 20;
  const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const offset = (safePage - 1) * safePageSize;

  const allowedItemTypes = new Set([
    "settlement",
    "consolidation",
    "payout",
    "private_sweep",
    "private_transfer"
  ]);
  const normalizedItemTypes = Array.isArray(itemTypes)
    ? itemTypes
        .map((value) => String(value || "").trim().toLowerCase())
        .filter((value) => allowedItemTypes.has(value))
    : [];

  const whereParts = [];
  if (normalizedItemTypes.length > 0) {
    whereParts.push(
      `itemType IN (${normalizedItemTypes.map((value) => sqlLiteral(value)).join(", ")})`
    );
  }
  const fromValue = String(createdFrom || "").trim();
  if (fromValue) {
    whereParts.push(`createdAt >= ${sqlLiteral(fromValue)}`);
  }
  const toValue = String(createdTo || "").trim();
  if (toValue) {
    whereParts.push(`createdAt <= ${sqlLiteral(toValue)}`);
  }

  const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
  const timelineUnionSql = buildTimelineUnionSql(merchantId, accountId);

  const items = all(`
    WITH timeline AS (
      ${timelineUnionSql}
    )
    SELECT *
    FROM timeline
    ${whereClause}
    ORDER BY createdAt DESC
    LIMIT ${safePageSize}
    OFFSET ${offset};
  `);

  const countRow = one(`
    WITH timeline AS (
      ${timelineUnionSql}
    )
    SELECT COUNT(*) AS total
    FROM timeline
    ${whereClause};
  `);
  const total = Number(countRow?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));

  return {
    items: enrichTimelinePrivacyStages(merchantId, accountId, items),
    page: safePage,
    pageSize: safePageSize,
    total,
    totalPages,
    hasNextPage: safePage < totalPages,
    hasPreviousPage: safePage > 1
  };
};

export const getTimeline = (merchantId, accountId, limit = 100) => {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 200)) : 100;
  return queryTimeline(merchantId, accountId, {
    page: 1,
    pageSize: safeLimit
  }).items;
};
