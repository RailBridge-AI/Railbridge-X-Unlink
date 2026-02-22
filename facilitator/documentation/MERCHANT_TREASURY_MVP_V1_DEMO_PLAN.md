# RailBridge Merchant Treasury OS — MVP v1 Demo Build Plan

## 1) Build Goal

Ship a demo-first Merchant Treasury OS in the shortest path, with one agent building sequentially end-to-end.

Primary success metric: a reliable live demo for judges.

---

## 2) Delivery Rules (Single Agent)

1. Build strictly in order.
2. Keep scope to MVP demo spec only.
3. Do not add production features unless required to unblock demo.
4. After each ticket: run smoke test + capture demo proof (screenshot/log/API response).
5. Enforce USDC-only asset scope in all ingest/API/consolidation flows.
6. Use custodial-only model: RailBridge-managed merchant wallets; no raw private keys in Merchant OS DB.

---

## 3) 8-Ticket Execution Queue

## Ticket 1 — Merchant OS app shell + demo storage + custody schema

Deliver:
- new `merchant-os` app scaffold (sibling app)
- DB bootstrap (SQLite/Postgres-lite)
- health endpoint
- merchant/account/wallet schema with `key_reference` fields

Done when:
- app starts locally
- DB tables from MVP spec can be created
- at least two demo merchants can be seeded with custodial wallets on multiple networks

## Ticket 2 — Demo Web2 auth + tenant scoping

Deliver:
- `POST /v1/demo/auth/login`
- session/JWT with merchant/account scope
- middleware that enforces merchant/account isolation on all account-scoped endpoints

Done when:
- user can log in and access only their merchant/account context
- cross-merchant data access is blocked

## Ticket 3 — Settlement event ingestion (merchant-scoped)

Deliver:
- endpoint/consumer that accepts settlement events from facilitator
- idempotency on `event_id`
- reject or ignore non-USDC events in demo mode
- require `merchant_id` and `account_id` on ingest

Done when:
- duplicate event does not duplicate records
- settlement row stores tx hash and status
- only USDC events are accepted
- events without merchant/account scope are rejected

## Ticket 4 — Balance projection (simple)

Deliver:
- projector that updates `treasury_balances` from settlement events
- unified USD summary calculation (demo-friendly conversion path)

Done when:
- balance updates after each new settlement event
- recompute from stored events gives same result

## Ticket 5 — Overview + settlements APIs

Deliver:
- `GET /overview`
- `GET /settlements`

Done when:
- APIs return correct totals, per-chain balances, and timeline states

## Ticket 6 — Policy API (minimal)

Deliver:
- `PUT /policy` and policy persistence
- policy returned in overview or dedicated response block
- `preferredAsset` locked to `USDC` in MVP v1

Done when:
- policy update visible immediately in API output

## Ticket 7 — Manual consolidation flow (custodial internal transfer)

Deliver:
- `POST /consolidations`
- lifecycle state updates (`requested -> submitted -> confirmed|failed`)
- bridge integration or deterministic simulation path
- asset validation restricted to `USDC`
- source and destination wallets resolved from merchant custodial wallet registry

Done when:
- request appears in settlement timeline with terminal status
- consolidation cannot target another merchant's wallet

## Ticket 8 — Demo UX + script polish

Deliver:
- simple dashboard page for login/balances/settlements/policy/consolidation trigger
- one-command demo script and seeded scenario data

Done when:
- full judge demo runs start-to-finish in <5 minutes

---

## 4) Suggested Timeline (Hackathon)

1. Day 1: Tickets 1-2
2. Day 2: Tickets 3-4
3. Day 3: Tickets 5-6
4. Day 4: Ticket 7
5. Day 5: Ticket 8 + polish + fallback rehearsals

---

## 5) Demo Checklist (Judge-Facing)

1. Start facilitator + merchant-os.
2. Log in as Merchant A (Web2 login) and show custodial wallet account context.
3. Run 2 same-chain and 1 cross-chain x402 USDC payments.
4. Open Merchant Treasury UI:
   - show unified balance increase
   - drill into per-chain balances
5. Update policy (preferred network, USDC fixed).
6. Trigger manual consolidation.
7. Show lifecycle moving to terminal state and updated balances.
8. Switch to Merchant B and show isolated balances/settlements.
9. Close with value statement:
   - "x402 captures revenue"
   - "Merchant OS makes revenue operational across chains with custodial wallet abstraction"

---

## 6) Fallback Plan (If live bridge/network is unstable)

1. Keep real settlement ingestion from facilitator.
2. Switch consolidation execution to deterministic simulated confirmation.
3. Label simulation mode in UI clearly.
4. Preserve same lifecycle states and traceability fields.

This keeps demo value intact while avoiding flaky external dependencies.
