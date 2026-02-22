# RailBridge Merchant Treasury OS — MVP v1 Demo Spec

## 1) Objective

Deliver a hackathon demo that proves one message:

**RailBridge (x402 facilitator) generates merchant revenue, and Merchant Treasury OS makes that revenue visible and manageable in a chain-abstracted way.**

This is a **demo MVP**, not production scope.

Current asset scope for this MVP: **USDC only**.

Current custody scope for this MVP: **custodial only** (RailBridge-managed merchant wallets).

---

## 2) Demo Story (What judges should see)

1. Merchant receives payments from multiple chains via x402 flow.
2. Merchant logs in with Web2 auth and opens their treasury account.
3. Treasury view shows one unified balance plus per-chain breakdown.
4. Merchant sets a preferred destination chain policy (asset fixed to USDC).
5. Merchant triggers manual consolidation between their custodial wallets.
6. Settlement and consolidation states update in near real time.

If these 6 moments work in one live flow, the MVP succeeds.

---

## 3) In Scope (MVP v1 Only)

1. Ingest x402 settlement outcomes into Merchant Treasury OS.
2. Support Web2 merchant login (demo-safe minimal auth).
3. Provision one custodial merchant account with one wallet per supported network.
4. Store only signer `key_reference` metadata in Merchant OS data store (no raw private keys).
5. Show balances:
   - unified USD value
   - per-chain USDC balances
6. Show settlement history with lifecycle state:
   - `settled_source`
   - `bridge_pending`
   - `bridge_confirmed`
   - `failed`
7. Allow policy update (minimum fields):
   - `preferredNetwork`
   - `autoBridgeEnabled`
   - `preferredAsset` is fixed to `USDC` in MVP v1
8. Allow manual consolidation request and show status.
9. Optional: allow payout request to an external merchant-provided address (read as "withdrawal"), but this is not required for core demo flow.

---

## 4) Out of Scope (Cut for Demo Speed)

1. Full Web2 auth stack hardening (OAuth SSO, MFA, password reset, device/session controls).
2. Full double-entry accounting across all event types.
3. Distributed event bus (Kafka/NATS) and advanced replay tooling.
4. Multi-provider bridge routing optimization.
5. Gas treasury automation/refill orchestration.
6. Production-grade reconciliation jobs and alerting stack.
7. Multi-tenant enterprise hierarchy.
8. Multi-asset support beyond USDC.

Use mocked or simplified implementations where needed for demo reliability.

---

## 5) Demo Architecture (Minimal Components)

## 5.1 Components

1. **Facilitator (existing app)**
   - remains x402 `/verify` + `/settle` source of truth for payment execution
   - emits a minimal settlement event to Merchant OS

2. **Merchant OS API (new sibling app)**
   - ingests settlement/consolidation events
   - computes and serves demo balance/settlement views
   - exposes auth, policy, consolidation, and read endpoints

3. **Demo Store (SQLite or Postgres-lite)**
   - stores merchant/account/wallet metadata, settlement events, balances, policy, consolidation requests

4. **Custody Signer Adapter (demo implementation)**
   - uses facilitator-managed signing key(s) to execute settlement and bridge
   - merchant-os stores wallet metadata and `key_reference` only

5. **Demo UI (simple web screen)**
   - reads Merchant OS endpoints
   - shows unified balance + lifecycle timeline + policy controls

## 5.2 Data Flow

1. Merchant logs in and Merchant OS resolves `merchant_id` + `account_id`.
2. x402 payment settles in Facilitator into merchant-scoped custodial flow.
3. Facilitator emits settlement event with `merchant_id` and `account_id` to Merchant OS.
4. Merchant OS upserts event and updates balance projection.
5. Merchant triggers consolidation request for source wallet -> destination wallet inside their custodial account.
6. Facilitator bridge worker executes CCTP transfer and Merchant OS updates lifecycle (`requested -> submitted -> confirmed|failed`).
7. UI fetches latest balances/settlements.

---

## 6) Minimal Data Model

Use only these tables/collections for MVP demo:

1. `merchant_users`
   - `id`
   - `merchant_id`
   - `email`
   - `password_hash` (or demo auth secret)
   - `role` (`admin` | `finance` | `readonly`)
   - `created_at`

2. `merchant_accounts`
   - `id`
   - `merchant_id`
   - `account_name`
   - `custody_mode` (`custodial`)
   - `created_at`

3. `merchant_account_wallets`
   - `id`
   - `merchant_id`
   - `account_id`
   - `network`
   - `asset` (must be `USDC`)
   - `address`
   - `key_reference` (string metadata, no raw private key)
   - `created_at`

4. `treasury_settlement_events`
   - `event_id` (unique)
   - `merchant_id`
   - `account_id`
   - `source_network`
   - `destination_network` (nullable)
   - `asset` (must be `USDC`)
   - `amount`
   - `status`
   - `tx_hash`
   - `created_at`

5. `treasury_balances`
   - `merchant_id`
   - `account_id`
   - `network`
   - `asset` (must be `USDC`)
   - `amount`
   - `usd_value`
   - `updated_at`

6. `treasury_policy`
   - `merchant_id`
   - `account_id`
   - `preferred_network`
   - `preferred_asset` (fixed `USDC`)
   - `auto_bridge_enabled`
   - `updated_at`

7. `treasury_consolidations`
   - `id`
   - `merchant_id`
   - `account_id`
   - `source_network`
   - `destination_network`
   - `asset` (must be `USDC`)
   - `amount`
   - `status`
   - `fail_reason`
   - `created_at`

8. `treasury_payout_requests` (optional for demo)
   - `id`
   - `merchant_id`
   - `account_id`
   - `network`
   - `asset` (must be `USDC`)
   - `amount`
   - `destination_address` (external merchant wallet)
   - `status`
   - `created_at`

---

## 7) Minimal API Surface

1. `GET /v1/demo/merchant/{merchantId}/accounts/{accountId}/overview`
   - returns unified balance + per-chain balances + basic KPIs

2. `GET /v1/demo/merchant/{merchantId}/accounts/{accountId}/settlements`
   - returns recent settlement/consolidation timeline

3. `POST /v1/demo/auth/login`
   - returns demo session/JWT scoped to merchant/account

4. `PUT /v1/demo/merchant/{merchantId}/accounts/{accountId}/policy`
   - updates preferred network/asset + auto-bridge toggle

5. `POST /v1/demo/merchant/{merchantId}/accounts/{accountId}/consolidations`
   - creates manual consolidation request

6. `POST /v1/demo/merchant/{merchantId}/accounts/{accountId}/payouts` (optional)
   - sends USDC from custodial account to external address

For hackathon speed, auth can be simplified but must still resolve merchant/account context from login.

Asset rule for all endpoints: `USDC` only. Any non-USDC asset input must return `400 Bad Request`.

Custody rule for consolidation: consolidation moves USDC between RailBridge-managed custodial wallets for the same `merchant_id` + `account_id`.

---

## 8) Reliability Rules (Minimal but Required)

1. Idempotency: ignore duplicate events by `event_id`.
2. Traceability: each settlement row links to source tx hash.
3. Determinism: balance projection recalculates same result from same events.
4. Graceful failure: failed consolidations are visible with `fail_reason`.
5. Isolation: every write/read path enforces merchant/account scoping.
6. Key handling: no raw private keys in Merchant OS DB; only `key_reference`.

---

## 9) Demo Acceptance Criteria

1. Merchant can log in via Web2 flow and load only their account data.
2. At least 3 successful x402 USDC settlements across 2+ chains appear in Merchant OS.
3. Unified balance and per-chain balances update after each settlement.
4. Policy update succeeds and is reflected in UI/API.
5. Manual consolidation can be triggered and reaches terminal state (`confirmed` or `failed`) with visible status.
6. (Optional) payout request to external address is visible with status.
7. Full demo flow runs in under 5 minutes without manual DB edits.

---

## 10) Post-Hackathon Upgrade Path

After demo validation, expand toward full spec:

1. Outbox + durable relay + replay CLI
2. Full ledger/invariants
3. Full auth/tenancy enforcement
4. Gas treasury automation
5. Production observability + reconciliation
6. Multi-asset support (after USDC-first validation)
