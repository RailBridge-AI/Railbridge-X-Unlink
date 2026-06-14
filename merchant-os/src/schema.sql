CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  compliance_profile_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS merchant_users (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_hash_algo TEXT NOT NULL DEFAULT 'pbkdf2_sha512',
  role TEXT NOT NULL CHECK(role IN ('admin', 'finance', 'readonly')),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS merchant_accounts (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  account_name TEXT NOT NULL,
  custody_mode TEXT NOT NULL DEFAULT 'custodial',
  status TEXT NOT NULL DEFAULT 'active',
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
  signer_provider TEXT NOT NULL DEFAULT 'mpc',
  signer_reference TEXT,
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
  treasury_mode TEXT NOT NULL DEFAULT 'public' CHECK (treasury_mode IN ('public', 'private')),
  private_home_network TEXT,
  privacy_enabled_at TEXT,
  auto_bridge_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (merchant_id, account_id)
);

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

CREATE INDEX IF NOT EXISTS idx_payment_requirement_contexts_tenant_issued
  ON payment_requirement_contexts(merchant_id, account_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_requirement_contexts_status_expires
  ON payment_requirement_contexts(status, expires_at);

CREATE INDEX IF NOT EXISTS idx_payment_requirement_contexts_settlement
  ON payment_requirement_contexts(settlement_id);

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
  fail_reason TEXT,
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_tenant_tx_status
  ON treasury_settlement_events(merchant_id, account_id, tx_hash, status);

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

CREATE INDEX IF NOT EXISTS idx_treasury_consolidations_tenant_created
  ON treasury_consolidations(merchant_id, account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS treasury_payout_requests (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  account_id TEXT NOT NULL REFERENCES merchant_accounts(id),
  network TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  destination_address TEXT NOT NULL,
  status TEXT NOT NULL,
  fail_reason TEXT,
  tx_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

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

CREATE INDEX IF NOT EXISTS idx_private_accounts_tenant
  ON private_accounts(merchant_id, account_id, provider, environment, role);

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

CREATE INDEX IF NOT EXISTS idx_private_ledger_entries_tenant_created
  ON private_ledger_entries(merchant_id, account_id, network, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_private_ledger_entries_reference
  ON private_ledger_entries(reference_type, reference_id);

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

CREATE INDEX IF NOT EXISTS idx_omnibus_sweeps_tenant_created
  ON omnibus_sweeps(merchant_id, account_id, created_at DESC);

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

CREATE INDEX IF NOT EXISTS idx_private_transfers_tenant_created
  ON private_transfers(merchant_id, account_id, created_at DESC);

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

CREATE INDEX IF NOT EXISTS idx_private_balance_snapshots_tenant_recorded
  ON private_balance_snapshots(merchant_id, account_id, network, recorded_at DESC);

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

CREATE INDEX IF NOT EXISTS idx_payout_address_book_tenant
  ON payout_address_book_entries(merchant_id, account_id, network, created_at);

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

CREATE INDEX IF NOT EXISTS idx_chain_catalog_status
  ON chain_catalog(status);

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

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant
  ON api_keys(merchant_id, account_id, status);

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

CREATE INDEX IF NOT EXISTS idx_webhooks_tenant
  ON webhook_endpoints(merchant_id, account_id, status);

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

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_event
  ON webhook_deliveries(event_id, event_type);

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

CREATE INDEX IF NOT EXISTS idx_bridge_jobs_status
  ON bridge_jobs(status, next_retry_at);

CREATE TABLE IF NOT EXISTS tenant_mutation_locks (
  lock_key TEXT PRIMARY KEY,
  owner_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tenant_mutation_locks_expires
  ON tenant_mutation_locks(expires_at);
