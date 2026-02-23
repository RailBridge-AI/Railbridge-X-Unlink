CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS merchant_users (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'finance', 'readonly')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS merchant_accounts (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  account_name TEXT NOT NULL,
  custody_mode TEXT NOT NULL DEFAULT 'custodial',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS merchant_account_wallets (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  account_id TEXT NOT NULL REFERENCES merchant_accounts(id),
  network TEXT NOT NULL,
  asset TEXT NOT NULL,
  address TEXT NOT NULL,
  key_reference TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(account_id, network, asset)
);

CREATE TABLE IF NOT EXISTS custody_keys (
  key_reference TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  account_id TEXT NOT NULL REFERENCES merchant_accounts(id),
  address TEXT NOT NULL,
  encrypted_private_key TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_custody_keys_tenant
  ON custody_keys(merchant_id, account_id, key_reference);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES merchant_users(id),
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  account_id TEXT NOT NULL REFERENCES merchant_accounts(id),
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS treasury_policy (
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  account_id TEXT NOT NULL REFERENCES merchant_accounts(id),
  preferred_network TEXT NOT NULL,
  preferred_asset TEXT NOT NULL,
  auto_bridge_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (merchant_id, account_id)
);

CREATE TABLE IF NOT EXISTS api_products (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  account_id TEXT NOT NULL REFERENCES merchant_accounts(id),
  api_id TEXT NOT NULL,
  api_name TEXT NOT NULL,
  description TEXT,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  source_network TEXT NOT NULL,
  source_asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  settlement_mode TEXT NOT NULL CHECK (settlement_mode IN ('same_chain', 'cross_chain')),
  destination_network TEXT,
  destination_asset TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, method, path)
);

CREATE TABLE IF NOT EXISTS treasury_settlement_events (
  event_id TEXT PRIMARY KEY,
  settlement_id TEXT NOT NULL,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  account_id TEXT NOT NULL REFERENCES merchant_accounts(id),
  api_id TEXT,
  api_route TEXT,
  api_name TEXT,
  source_network TEXT NOT NULL,
  destination_network TEXT,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  status TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  source_tx_hash TEXT,
  bridge_tx_hash TEXT,
  destination_tx_hash TEXT,
  block_number INTEGER,
  log_index INTEGER,
  confirmations INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_settlement_tenant
  ON treasury_settlement_events(merchant_id, account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS treasury_balances (
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  account_id TEXT NOT NULL REFERENCES merchant_accounts(id),
  network TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  usd_value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (merchant_id, account_id, network, asset)
);

CREATE TABLE IF NOT EXISTS treasury_consolidations (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  account_id TEXT NOT NULL REFERENCES merchant_accounts(id),
  source_network TEXT NOT NULL,
  destination_network TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  status TEXT NOT NULL,
  fail_reason TEXT,
  tx_hash TEXT,
  source_tx_hash TEXT,
  bridge_tx_hash TEXT,
  destination_tx_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS treasury_payout_requests (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  account_id TEXT NOT NULL REFERENCES merchant_accounts(id),
  network TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  destination_address TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
