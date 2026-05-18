# RailBridge Merchant Treasury OS — Technical Specification

## 1. Purpose

## Companion Delivery Plan

For AI-agent execution planning and sprint operations, see `MERCHANT_TREASURY_AI_AGENT_SPRINT_PLAN.md`.
For current prototype demo scope and setup, see `merchant-os/DEMO_GUIDE.md` and `merchant-os/ONBOARDING_TECHNICAL.md`.

---

This spec defines how to evolve RailBridge from a cross-chain x402 facilitator into a merchant treasury platform that provides:

- Unified balances across chains/assets
- Policy-driven settlement and rebalancing
- Gas abstraction for multi-chain operations
- Merchant-facing APIs and dashboard data
- Web2-friendly merchant onboarding, auth, and custody controls

RailBridge remains the x402 facilitator for merchant payment revenue; Merchant Treasury OS is the chain-abstracted operating layer used to manage that x402-generated revenue.

This document is implementation-oriented and designed for engineering planning and sprint execution.

---

## 1.1 Alignment statement (MVP scope lock)

We are aligned on an MVP that does **three things first**:

1. Gives merchants a Web2-simple dashboard for earnings, balances by chain, and transaction history.
2. Abstracts chain fragmentation by presenting one treasury account view with per-chain balance drill-down.
3. Supports manual consolidation into a preferred destination chain, with policy automation added incrementally.

Out of scope for MVP v1: advanced non-custodial wallet orchestration, complex strategy automation, and multi-account hierarchy management.

Current implementation constraint: MVP v1 asset support is USDC-only; multi-asset support is a later phase.

---

## 2. Current System Baseline

Today RailBridge has:

- x402 facilitator endpoints (`/verify`, `/settle`, `/supported`, `/health`)
- Multi-chain EVM exact payment routing
- Cross-chain extension parsing
- Async bridging triggered after successful settle
- Circle CCTP bridge service + liquidity/rate checks

### Current constraints

- No merchant ledger or double-entry accounting layer
- No idempotent event backbone for replayable treasury state
- No merchant policy model for destination asset/chain behavior
- No gas treasury automation
- No merchant-facing treasury API

---

## 3. Product Requirements (MVP)

## 3.1 Functional requirements

1. Merchant can view balances by chain/asset and unified USD-equivalent balance.
2. Merchant can configure default treasury policy:
   - Preferred settlement chain
   - Preferred settlement asset
   - Auto-bridge on/off
   - Payout threshold
3. Every payment updates immutable ledger entries and derived balances.
4. System tracks settlement lifecycle states:
   - `verified`
   - `settled_source`
   - `bridge_pending`
   - `bridge_confirmed`
   - `failed`
5. Merchant can list settlement history and failure reasons.
6. Merchant can view account balance by chain, token, and consolidated USD value for one treasury account.
7. Merchant can manually trigger consolidation from source chains into a destination chain.
8. Merchant user authentication supports standard Web2 workflows (email/password + OAuth SSO).
9. Treasury account model clearly separates custodial assets (RailBridge-managed wallets) from future non-custodial mode.

## 3.2 Non-functional requirements

- Idempotent processing for all event consumers
- At-least-once delivery with safe replay
- Event-to-balance update latency under 5s P95 (MVP target)
- Reconciliation drift under 0.1% on sampled checks
- Auditability: all balance changes traceable to event IDs and tx hashes
- Strong tenancy isolation: merchant users can only access treasury accounts for their organization

---

## 4. Target Architecture

## 4.1 Services

1. **Payment Orchestrator** (existing facilitator + extracted orchestration)
   - Handles verify/settle
   - Emits canonical domain events
2. **Bridge Execution Service**
   - Executes bridge transfers using provider adapters
   - Emits bridge lifecycle events
3. **Treasury Ledger Service**
   - Writes immutable journal entries
   - Maintains materialized balances
4. **Merchant API Service**
   - Exposes balances, settlements, policies, payouts
5. **Wallet Custody Service (MVP custodial)**
   - Creates and stores merchant vault wallets by supported chain
   - Signs operational transactions through HSM/MPC-backed key management
   - Exposes internal APIs for balance sync and consolidation execution

## 4.2 Data flow

1. Client payment verified/settled by orchestrator.
2. Orchestrator emits `payment.verified` and `payment.settled_source`.
3. If policy requires consolidation or destination routing, orchestrator enqueues bridge command.
4. Bridge service emits `bridge.submitted` and `bridge.confirmed`.
5. Ledger service consumes all events, writes journal entries, updates balances.
6. Merchant API reads derived views (`merchant_balances`, `merchant_settlements`).
7. Wallet custody service indexes per-chain wallet balances and emits `wallet.balance_synced` events.

## 4.3 Event transport

Recommended: Postgres outbox + queue worker (MVP), then optional Kafka/NATS at scale.

- Outbox table written in same transaction as source business state.
- Relay worker publishes to queue topic.
- Consumers use idempotency key (`event_id`).

---

## 5. Domain Model

## 5.1 Core entities

- `merchant`
- `payment_intent`
- `settlement`
- `bridge_transfer`
- `ledger_entry`
- `balance_snapshot`
- `treasury_policy`
- `gas_account`
- `merchant_user`
- `merchant_account`
- `merchant_account_wallet`
- `wallet_balance`
- `consolidation_request`

## 5.2 Suggested SQL schema (minimal)

```sql
create table merchants (
  id uuid primary key,
  name text not null,
  legal_entity_name text,
  default_currency text not null default 'USD',
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table merchant_users (
  id uuid primary key,
  merchant_id uuid not null references merchants(id),
  email text not null,
  password_hash text,
  oauth_provider text,
  oauth_subject text,
  role text not null default 'admin',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique(merchant_id, email)
);

create table merchant_accounts (
  id uuid primary key,
  merchant_id uuid not null references merchants(id),
  account_name text not null default 'Primary Treasury',
  custody_mode text not null default 'custodial', -- custodial | external (future)
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table merchant_account_wallets (
  id uuid primary key,
  merchant_account_id uuid not null references merchant_accounts(id),
  network text not null,
  address text not null,
  wallet_provider text not null, -- fireblocks/dfns/custom
  key_reference text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique(merchant_account_id, network)
);

create table payment_intents (
  id uuid primary key,
  merchant_id uuid not null references merchants(id),
  merchant_account_id uuid not null references merchant_accounts(id),
  external_reference text,
  payer_address text,
  source_network text not null,
  source_asset text not null,
  amount_numeric numeric(38, 0) not null,
  status text not null,
  created_at timestamptz not null default now()
);

create table settlements (
  id uuid primary key,
  payment_intent_id uuid not null references payment_intents(id),
  merchant_account_id uuid not null references merchant_accounts(id),
  source_tx_hash text not null,
  source_network text not null,
  destination_network text,
  destination_asset text,
  status text not null,
  fail_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table bridge_transfers (
  id uuid primary key,
  settlement_id uuid not null references settlements(id),
  provider text not null,
  provider_transfer_id text,
  source_network text not null,
  destination_network text not null,
  amount_numeric numeric(38, 0) not null,
  status text not null,
  fail_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table wallet_balances (
  id uuid primary key,
  merchant_account_id uuid not null references merchant_accounts(id),
  network text not null,
  asset text not null,
  amount_numeric numeric(38, 0) not null,
  amount_usd numeric(38, 8),
  as_of_block bigint,
  as_of timestamptz not null default now(),
  unique(merchant_account_id, network, asset)
);

create table consolidation_requests (
  id uuid primary key,
  merchant_account_id uuid not null references merchant_accounts(id),
  source_network text not null,
  destination_network text not null,
  asset text not null,
  amount_numeric numeric(38, 0) not null,
  status text not null, -- requested|submitted|confirmed|failed
  bridge_transfer_id uuid references bridge_transfers(id),
  requested_by_user_id uuid not null references merchant_users(id),
  fail_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ledger_entries (
  id uuid primary key,
  merchant_id uuid not null references merchants(id),
  event_id uuid not null,
  account_code text not null,
  chain_id text,
  asset text,
  debit numeric(38, 0) not null default 0,
  credit numeric(38, 0) not null default 0,
  reference_type text not null,
  reference_id uuid not null,
  created_at timestamptz not null default now(),
  unique(event_id, account_code, reference_id)
);

create table treasury_policies (
  merchant_account_id uuid primary key references merchant_accounts(id),
  preferred_network text not null,
  preferred_asset text not null,
  auto_bridge_enabled boolean not null default true,
  auto_consolidation_enabled boolean not null default false,
  payout_threshold numeric(38, 0),
  rebalance_strategy jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
```

## 5.3 Custody and account model (MVP decision)

- MVP is **custodial by default** to keep UX Web2-simple and allow deterministic balance tracking.
- Each merchant gets one `merchant_account` and one operational wallet per supported chain.
- Private keys are never stored directly in app DB; only `key_reference` to secure signer (MPC/HSM vendor).
- Future non-custodial mode is modeled via `merchant_accounts.custody_mode = external`.

## 5.4 Auth model (Web2-friendly)

- Merchant users authenticate with email/password or OAuth (Google/Microsoft).
- Access tokens are session/JWT based and map user -> merchant -> account scope.
- API authz enforced by role (`admin`, `finance`, `readonly`) and account ownership.
- Optional 2FA required for sensitive operations (policy update, consolidation, payout).

---

## 6. API Specification (Merchant-facing)

Base path: `/v1/merchant`

Auth model: bearer token (JWT/session) with merchant/account scoped claims.

Authorization checks are mandatory on every account-scoped endpoint:
- `merchantId` in path must match token merchant scope
- `accountId` in path must be one of token-authorized accounts
- write actions (`policy`, `consolidations`, `payouts`) require role `admin` or `finance`

## 6.1 Balances

`GET /v1/merchant/{merchantId}/accounts/{accountId}/balances`

Response:

```json
{
  "merchantId": "uuid",
  "accountId": "uuid",
  "asOf": "2026-01-01T00:00:00Z",
  "unifiedUsd": "10234.12",
  "balances": [
    {
      "network": "eip155:8453",
      "asset": "USDC",
      "amount": "10000000",
      "decimals": 6,
      "usdValue": "10000.00"
    }
  ]
}
```

## 6.2 Settlements list

`GET /v1/merchant/{merchantId}/accounts/{accountId}/settlements?status=&from=&to=&cursor=`

Returns paginated settlement lifecycle including bridge status and failure reason.

## 6.3 Policy read/update

- `GET /v1/merchant/{merchantId}/accounts/{accountId}/policy`
- `PUT /v1/merchant/{merchantId}/accounts/{accountId}/policy`

`PUT` request:

```json
{
  "preferredNetwork": "eip155:8453",
  "preferredAsset": "USDC",
  "autoBridgeEnabled": true,
  "payoutThreshold": "500000000"
}
```

## 6.4 Payout trigger (MVP manual)

`POST /v1/merchant/{merchantId}/accounts/{accountId}/payouts`

```json
{
  "destinationAddress": "0xabc...",
  "network": "eip155:8453",
  "asset": "USDC",
  "amount": "1000000"
}
```

## 6.5 Consolidation trigger (MVP manual)

`POST /v1/merchant/{merchantId}/accounts/{accountId}/consolidations`

```json
{
  "sourceNetwork": "eip155:10",
  "destinationNetwork": "eip155:8453",
  "asset": "USDC",
  "amount": "250000000"
}
```

## 6.6 Auth endpoints (merchant dashboard)

- `POST /v1/auth/login`
- `POST /v1/auth/oauth/callback`
- `POST /v1/auth/logout`
- `POST /v1/auth/mfa/verify`

---

## 6.7 Consolidation lifecycle (MVP state machine)

`requested -> submitted -> confirmed | failed`

Rules:
- only `admin` or `finance` can create a consolidation request
- request amount cannot exceed account `available` balance on source chain/asset
- failed consolidations preserve immutable settlement and ledger history; retries create new requests

---

## 7. Event Contract

All events share envelope:

```json
{
  "eventId": "uuid",
  "eventType": "payment.settled_source",
  "eventVersion": 1,
  "occurredAt": "2026-01-01T00:00:00Z",
  "merchantId": "uuid",
  "idempotencyKey": "string",
  "payload": {}
}
```

## 7.1 Event types (MVP)

- `payment.verified`
- `payment.settled_source`
- `bridge.submitted`
- `bridge.confirmed`
- `bridge.failed`
- `fee.recorded`
- `wallet.balance_synced`
- `consolidation.requested`
- `consolidation.confirmed`
- `consolidation.failed`
- `payout.requested`
- `payout.completed`

Consumers must treat unknown fields as forward-compatible.

---

## 8. Ledger Rules (Double-entry)

For `payment.settled_source`:

- Debit: `chain_clearing:<source_network>:<asset>`
- Credit: `merchant_pending:<merchant_id>:<asset>`

For `bridge.confirmed`:

- Debit: `merchant_pending:<merchant_id>:<source_asset>`
- Credit: `merchant_available:<merchant_id>:<destination_asset>`

For bridge fee:

- Debit: `merchant_fee_expense:<merchant_id>:<asset>`
- Credit: `railbridge_fee_revenue:<asset>`

Invariant: total debits = total credits per event group.

---

## 9. Refactor Plan (Engineering Breakdown)

## Phase 0 — Prep (3-5 days)

- Add feature flags for treasury mode
- Add correlation IDs and request IDs in facilitator logs
- Define canonical event schema in repo (`/facilitator/documentation/events/`)

## Phase 1 — Event backbone + outbox (1 sprint)

- Emit events from verify/settle lifecycle
- Add outbox table + relay worker
- Add consumer skeleton with idempotency guard

Deliverables:

- Event replay CLI for local/dev environments
- Observability dashboard (event lag, consumer failures)

## Phase 2 — Ledger MVP (1 sprint)

- Implement journal writer
- Materialized balance projector
- Reconciliation job (source chain sampled verification)

Deliverables:

- `GET balances` endpoint backed by derived tables
- Drift report + alert thresholds

## Phase 3 — Policy engine MVP (1 sprint)

- Add merchant policy table/API
- Orchestrator reads policy at settle completion
- Create bridge command decision function based on policy

Deliverables:

- Deterministic policy evaluation logs
- Policy validation (supported network/asset)

## Phase 4 — Merchant treasury API + dashboard backend (1 sprint)

- Settlements list API with lifecycle state
- Policy API (get/update)
- Manual payout trigger API

Deliverables:

- OpenAPI spec
- API auth scopes (`merchant:read`, `merchant:write`)

## Phase 5 — Gas treasury (1 sprint)

- Gas account tracker per network
- Refill rules + alerts
- Gas fee attribution per settlement/bridge

Deliverables:

- Gas health endpoint
- Per-merchant gas cost reporting

---

## 10. Acceptance Criteria

1. A payment processed cross-chain results in:
   - settlement record
   - bridge transfer record
   - ledger entries
   - updated merchant available balance
2. Replay of same event does not duplicate balances.
3. Merchant policy update changes routing behavior for new settlements only.
4. Failed bridge emits failure reason visible through settlements API.
5. Reconciliation job can map ledger movements to tx hashes.

---

## 11. Risks and Mitigations

1. **Event duplication / ordering**
   - Mitigation: idempotency keys + per-aggregate ordering keys.
2. **Bridge finality uncertainty**
   - Mitigation: state machine with timeout/escalation and delayed retries.
3. **Ledger correctness drift**
   - Mitigation: invariant checks + daily reconciliation job + dead-letter queue.
4. **Policy complexity creep**
   - Mitigation: start with 4 policy fields; add advanced policies behind versioned schema.

---

## 12. Sprint Ticket Starter List

- `TREASURY-001`: Define event schema + TypeScript types
- `TREASURY-002`: Add outbox table and repository
- `TREASURY-003`: Emit events in `/verify` and `/settle` pipeline
- `TREASURY-004`: Build outbox relay worker
- `TREASURY-005`: Ledger entry writer + invariants
- `TREASURY-006`: Balance projection job
- `TREASURY-007`: Merchant balances API
- `TREASURY-008`: Merchant policy API
- `TREASURY-009`: Settlement history API
- `TREASURY-010`: Bridge failure reason normalization
- `TREASURY-011`: Reconciliation job + alerting
- `TREASURY-012`: Gas account monitoring + refill automation

---

## 13. Recommended Implementation Order

Build in this strict order:

1. Event backbone
2. Ledger correctness
3. Policy engine
4. Merchant APIs
5. Dashboard UI

This keeps "treasury truth" correct before exposing merchant controls.
