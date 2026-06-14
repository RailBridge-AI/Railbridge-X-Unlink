# RailBridge Private Treasury Micro-Spec

Last updated: 2026-06-13

Companion documents:

- `facilitator/documentation/PRIVATE_TREASURY_ARCHITECTURE.md`
- `facilitator/documentation/PRIVATE_TREASURY_IMPLEMENTATION_PLAN.md`

## Purpose

This document freezes the minimum contracts that should be agreed before implementation starts.

It covers three things:

1. the payment requirement metadata contract
2. the `privacyVaultService` interface
3. the private-ledger and idempotency model

This is intentionally MVP-scoped.

## Locked MVP decisions

These decisions are assumed by the rest of this spec:

- first private treasury environment is `base-sepolia`
- private treasury MVP is same-environment first
- Merchant OS owns Unlink integration
- Merchant OS treasury logic owns the public intake signing keys for privacy-mode routes
- facilitator performs public x402 verification and settlement, but does not own long-term treasury key material
- private-mode merchants must still accept unsupported routes by downgrading to `public_fallback`
- public x402 settlement remains public; privacy starts after settlement

## Goals of this micro-spec

After this document, implementation should not have to guess:

- what private-mode requirements look like
- how a settlement is attributed without leaked merchant ids
- what methods `privacyVaultService` exposes
- what records are the source of truth for balances and transaction history
- where idempotency is enforced

## Contract 1: payment requirement metadata

## 1.1 Rule

For merchants in `private` treasury mode:

- never expose `merchantId` or `accountId` in client-visible requirement metadata
- always issue an opaque `paymentContextId`
- always mark the route with a computed `privacyCoverageMode`

This remains true even when the route downgrades to `public_fallback`.

## 1.2 Private-mode requirement shape

Private-mode requirement payloads should keep the existing x402-compatible fields and add a RailBridge privacy block inside `extra`.

Suggested shape:

```json
{
  "scheme": "exact",
  "network": "base-sepolia",
  "payTo": "0xRailBridgeIntakeOrPublicFallbackAddress",
  "price": {
    "asset": "0xTokenAddress",
    "amount": "1000000",
    "extra": {
      "apiId": "prod_123",
      "apiName": "Premium API",
      "method": "GET",
      "route": "/api/premium"
    }
  },
  "extra": {
    "apiId": "prod_123",
    "apiName": "Premium API",
    "method": "GET",
    "route": "/api/premium",
    "description": "Premium API (GET /api/premium)",
    "rbPrivacy": {
      "treasuryMode": "private",
      "privacyCoverageMode": "full_private",
      "paymentContextId": "pctx_...",
      "privateHomeNetwork": "base-sepolia"
    }
  }
}
```

## 1.3 Public-mode requirement shape

For the first pass:

- public mode may keep current behavior
- legacy `merchantId` and `accountId` support may remain temporarily for public-mode routes only

That lets us implement private-mode attribution first without forcing an immediate repo-wide migration.

## 1.4 `privacyCoverageMode`

`privacyCoverageMode` is computed, not stored as merchant policy.

Allowed values for MVP:

- `full_private`
- `public_fallback`

Rules:

- `full_private` means the requirement will settle to a RailBridge-controlled public intake and then move into the private treasury flow
- `public_fallback` means the merchant is in `private` treasury mode, but this specific route is handled by the current public path

For MVP:

- `full_private` only when merchant `privateHomeNetwork = base-sepolia` and source network is `base-sepolia`
- every other private-mode route should resolve as `public_fallback`

## 1.5 Merchant OS resolved response contract

`resolvePaymentRequirementsForTenant(...)` should keep returning:

- `settlementMode`
- `requirement`
- `requirements`
- `crossChain`

For private-mode routes it should additionally guarantee:

- `requirement.extra.rbPrivacy` exists
- `requirements[*].extra.rbPrivacy` exists
- `merchantId` and `accountId` are absent from every client-visible requirement option

Top-level resolved response fields may still contain internal merchant/account context for server-only use during migration, but `paymentGuard` must not copy them into `accepts` for private-mode routes.

## 1.6 `paymentGuard` contract

`packages/server-sdk/src/paymentGuard.js` should follow this rule:

- if `requirement.extra.rbPrivacy.paymentContextId` exists, do not attach `merchantId` or `accountId` to `accepts`
- preserve `extra.rbPrivacy` exactly as returned by Merchant OS

This is the main client-visible leak boundary.

## 1.7 Facilitator extraction contract

The facilitator should extract merchant settlement attribution in this order:

1. `requirements.extra.rbPrivacy.paymentContextId`
2. legacy `requirements.extra.merchantId` and `requirements.extra.accountId`
3. legacy `requirements.price.extra.merchantId` and `requirements.price.extra.accountId`
4. address-map fallback

If `paymentContextId` is present:

- it becomes the primary attribution handle
- `merchantAddress` may still be used as an audit field, but not as the authoritative merchant resolution input

## Contract 2: settlement ingest payload

## 2.1 New ingest fields

For private-mode routes, `MerchantOsPublisher.publishSettlementEvent(...)` should send these extra fields to Merchant OS:

- `paymentContextId`
- `treasuryMode`
- `privacyCoverageMode`
- `scheme`
- `publicPayTo`

Suggested ingest payload additions:

```json
{
  "paymentContextId": "pctx_...",
  "treasuryMode": "private",
  "privacyCoverageMode": "full_private",
  "scheme": "exact",
  "publicPayTo": "0xRailBridgeIntakeAddress"
}
```

Existing fields like `sourceNetwork`, `amount`, `asset`, `txHash`, and `settlementId` remain required.

## 2.2 Ingest attribution rule

Merchant OS ingest should resolve tenant attribution as follows:

1. if `paymentContextId` exists, resolve tenant from `payment_requirement_contexts`
2. otherwise use the current legacy `merchantId` / `accountId` path

This should let us migrate private mode first without breaking public mode.

## 2.3 Attribution integrity check

When `paymentContextId` is used, Merchant OS must validate that the settlement matches the context record on:

- `scheme`
- `source_network`
- `asset`
- `amount`
- `public_pay_to`

If any of those differ:

- reject the event
- do not create a private ledger credit
- surface a structured ingest error for operator review

## Contract 3: `payment_requirement_contexts`

## 3.1 Table purpose

`payment_requirement_contexts` binds one issued private-mode requirement to one future settlement attribution.

It is:

- opaque
- short-lived
- one-time use
- non-secret by itself

## 3.2 Suggested schema

Suggested table:

- `payment_requirement_contexts`

Suggested columns:

- `id`
- `payment_context_id`
- `merchant_id`
- `account_id`
- `api_product_id`
- `treasury_mode`
- `privacy_coverage_mode`
- `private_home_network`
- `scheme`
- `source_network`
- `destination_network`
- `asset`
- `amount`
- `public_pay_to`
- `settlement_id`
- `status`
- `issued_at`
- `expires_at`
- `settled_at`
- `consumed_at`
- `metadata_json`

Suggested statuses:

- `issued`
- `settled`
- `consumed`
- `expired`
- `failed`

## 3.3 Required indexes and uniqueness

Minimum constraints:

- unique index on `payment_context_id`
- index on `(merchant_id, account_id, issued_at DESC)`
- index on `(status, expires_at)`
- index on `settlement_id`

## 3.4 Context lifetime

Recommended default:

- `PAYMENT_CONTEXT_TTL_MS = 3600000`

That is:

- 60 minutes by default
- configurable later if the product needs a longer requirement lifetime

## 3.5 Consumption rules

A `paymentContextId` may be:

- issued once
- bound to at most one `settlementId`
- consumed once into merchant attribution

Allowed transitions:

- `issued -> settled`
- `settled -> consumed`
- `issued -> expired`
- `issued -> failed`
- `settled -> failed`

Duplicate lifecycle events for the same `settlementId` are allowed to no-op, but a different `settlementId` must never reuse the same `paymentContextId`.

## Contract 4: `privacyVaultService`

## 4.1 Purpose

`privacyVaultService` is the single provider boundary for private treasury operations.

File:

- `merchant-os/src/privacyVaultService.js`

It should hide:

- Unlink SDK surface differences
- account registration details
- provider transaction polling
- provider-specific response shapes

## 4.2 Responsibilities

`privacyVaultService` should own:

- environment lookup
- omnibus account lookup and registration
- merchant private account lookup and creation
- balance reads
- public-intake-to-Unlink deposits
- private transfers
- withdrawals
- transaction polling and normalization

## 4.3 Normalized account shape

Suggested normalized account object:

```js
{
  provider: "unlink",
  environment: "base-sepolia",
  role: "omnibus" | "merchant",
  merchantId: "optional",
  accountId: "optional",
  unlinkAddress: "unlink1...",
  status: "active",
  keyReference: "secret ref or encrypted key ref"
}
```

## 4.4 Required methods

Suggested first-pass interface:

```js
await privacyVaultService.getEnvironmentForNetwork(network);
await privacyVaultService.ensureOmnibusAccount({ environment });
await privacyVaultService.getOrCreateMerchantAccount({ merchantId, accountId, environment });
await privacyVaultService.getBalances({ environment, accountRef, token });
await privacyVaultService.depositFromIntake({
  environment,
  sourcePrivateKeyRef,
  omnibusAccountRef,
  token,
  amount,
  idempotencyKey
});
await privacyVaultService.transferPrivately({
  environment,
  fromAccountRef,
  toUnlinkAddress,
  token,
  amount,
  idempotencyKey
});
await privacyVaultService.withdrawToEvm({
  environment,
  fromAccountRef,
  recipientEvmAddress,
  token,
  amount,
  idempotencyKey
});
await privacyVaultService.getTransactionStatus({ environment, txId });
await privacyVaultService.waitForTransaction({
  environment,
  txId,
  intervalMs,
  timeoutMs
});
```

## 4.5 Required return shape

Every mutating provider call should normalize to this shape:

```js
{
  provider: "unlink",
  environment: "base-sepolia",
  txId: "provider tx id",
  txHash: "optional provider tx hash",
  status: "pending" | "processed" | "failed",
  errorCode: null,
  errorMessage: null,
  raw: {}
}
```

## 4.6 Balance reads

For Unlink, balance reads should be implemented through `getBalances()` and optional token filtering.

That means `privacyVaultService.getBalances(...)` should:

- treat provider balance reads as first-class
- not infer balances only from transaction history
- still reconcile provider balance snapshots against the internal ledger
- support a freshness indicator so Merchant OS can distinguish live provider reads from fallback values

## 4.7 Secrets rule

Merchant private account material and omnibus account material must not be stored in plaintext.

MVP recommendation:

- reuse the same encryption/key-reference pattern already used for `custody_keys`
- store provider account secrets through references, not inline in business tables

## Contract 5: private accounts and ledger model

## 5.1 Source-of-truth rule

For private-mode merchants:

- public RPC balance reads are not the primary balance source
- the live spendable private balance inside Unlink should come from `getBalances()` when available
- the internal private ledger is the workflow source of truth for pending sweep, pending withdrawal, and reconciliation state
- Unlink balance reads and internal ledger state should be presented together, not as competing views

In practice, private mode has two related balance truths:

- `privateAvailableBalance`: provider-first, live when possible
- `treasuryWorkflowState`: ledger-first for amounts still moving through intake, sweep, transfer, or withdrawal states

## 5.2 New tables

Minimum new tables:

- `private_accounts`
- `private_ledger_entries`
- `private_balance_snapshots`
- `omnibus_sweeps`
- `private_transfers`
- `withdrawal_batches`

## 5.3 Suggested `private_accounts` fields

- `id`
- `merchant_id`
- `account_id`
- `provider`
- `environment`
- `role`
- `unlink_address`
- `key_reference`
- `status`
- `created_at`
- `updated_at`

Recommended uniqueness:

- unique `(account_id, provider, environment, role)`

## 5.4 Suggested `private_ledger_entries` fields

- `id`
- `merchant_id`
- `account_id`
- `environment`
- `asset`
- `entry_type`
- `direction`
- `amount`
- `available_delta`
- `pending_sweep_delta`
- `pending_withdrawal_delta`
- `reference_type`
- `reference_id`
- `idempotency_key`
- `created_at`

Recommended uniqueness:

- unique `idempotency_key`

## 5.5 Ledger event set

Minimum entry types:

- `payment.settled_public_intake`
- `omnibus.sweep_submitted`
- `omnibus.sweep_confirmed`
- `merchant.private_credit`
- `merchant.withdrawal_requested`
- `merchant.withdrawal_submitted`
- `merchant.withdrawal_confirmed`
- `merchant.withdrawal_failed`

## 5.6 Balance derivation

For private mode:

- `privateAvailableBalance` should come from a live Unlink balance read when available, filtered to the relevant token
- `pendingSweepBalance` comes from public intake rows not yet privately credited
- `pendingWithdrawalBalance` comes from requested or submitted withdrawals not yet confirmed

If the provider read is unavailable:

- use the most recent `private_balance_snapshots` record as a fallback
- continue deriving pending balances from the internal ledger
- expose a freshness field so the UI can label the balance as non-live

Suggested freshness values:

- `live`
- `cached`
- `degraded`

## Contract 6: route behavior by privacy coverage

## 6.1 `full_private`

For `full_private`:

1. requirement resolves to RailBridge intake wallet
2. facilitator settles publicly
3. Merchant OS stores public intake settlement event
4. Merchant OS creates a pending private ledger credit
5. sweep worker deposits to omnibus Unlink
6. Merchant OS records private transfer to merchant Unlink account
7. merchant private balance increases

## 6.2 `public_fallback`

For `public_fallback`:

1. requirement still uses opaque `paymentContextId`
2. merchant ids still stay out of client-visible requirement metadata
3. settlement uses the current public accounting path
4. no private sweep or private transfer is created for that route

This keeps the payment path available without pretending that the route became private.

## Contract 7: idempotency and locking

## 7.1 General rule

Every settlement-to-ledger transition must be safe to replay.

## 7.2 Idempotency keys

Minimum idempotency keys:

- payment context: `payment_context_id`
- intake credit: `private:intake:${settlementId}`
- sweep deposit: `private:sweep:${environment}:${batchId}`
- merchant private transfer: `private:transfer:${settlementId}:${merchantId}:${accountId}`
- private withdrawal submit: `private:withdrawal:${withdrawalRequestId}`

## 7.3 Locks

Reuse the existing DB lock pattern from `tenant_mutation_locks`.

Recommended lock keys:

- `privacy-sweep:${environment}`
- `private-payout:${merchantId}:${accountId}`
- `payment-context:${paymentContextId}`

## 7.4 Settlement ingest idempotency

Merchant OS ingest should:

1. dedupe settlement event rows by the existing event and lifecycle rules
2. dedupe private ledger creation by `idempotency_key`
3. only bind a `paymentContextId` to one `settlementId`

## Contract 8: history projection

## 8.1 Rule

History must remain operationally useful without implying that private legs have no transaction references.

## 8.2 Projection additions

Timeline items should expose:

- `historyKind`
- `provider`
- `providerTxId`
- `providerTxHash`
- `privacyCoverageMode`

Recommended `historyKind` values:

- `public_intake`
- `private_sweep`
- `private_transfer`
- `private_withdrawal`
- `public_payout`

This can be added without breaking the existing high-level item buckets of settlement and payout.

Balance responses should expose:

- `privateAvailableBalance`
- `pendingSweepBalance`
- `pendingWithdrawalBalance`
- `balanceFreshness`
- `lastProviderSyncAt`

## Contract 9: implementation order

Implementation should follow this exact sequence:

1. add policy fields to `treasury_policy`
2. add `payment_requirement_contexts`
3. update requirement resolution to emit `extra.rbPrivacy`
4. update `paymentGuard` to stop leaking merchant ids for private mode
5. update facilitator extraction and Merchant OS ingest to use `paymentContextId`
6. add `privacyVaultService`
7. add private ledger tables and idempotent credit creation
8. add same-environment sweep worker
9. add private payout flow
10. update UI projections

## Ready-to-code checklist

This micro-spec is complete enough to start coding when the team agrees to these final assertions:

- `extra.rbPrivacy` is the canonical private-mode requirement block
- `paymentContextId` is the canonical private-mode settlement attribution handle
- `privacyVaultService` lives in Merchant OS
- private-mode unsupported routes use `public_fallback`
- private available balance is provider-first when live reads succeed, while pending workflow state remains ledger-first
