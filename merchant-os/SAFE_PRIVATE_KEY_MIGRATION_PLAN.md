# Migration Plan: Safe Private Key Architecture (Roadmap)

## Status
Roadmap only. Not implemented yet.

## Goal
Migrate from a shared global custody derivation model to a production-safe model with merchant isolation and reduced blast radius.

## Why This Migration
1. A single master key is a high-risk single point of failure.
2. Key compromise blast radius should be limited to one merchant.
3. Custody/signing needs stronger auditability and operational controls.

## Locked Decisions
1. End-state custody model: Managed MPC.
2. Integration strategy: provider adapter first (vendor-agnostic interface).
3. Existing merchants: live rekey migration.
4. Address policy: rotate to new receive addresses.
5. Config hygiene: secrets in `.env`, non-sensitive controls in runtime JSON.

## Target End State
1. No operational signing path depends on one shared root secret.
2. Merchant custody is isolated by vault/provider account.
3. Payout and consolidation sign through custody provider APIs, not raw local private keys.
4. Migration lifecycle is visible and auditable per merchant/network.

## Phased Roadmap

### Phase 0: Hardening
1. Enforce custody master key presence/validity at startup.
2. Add migration feature flags and operational locks.
3. Add custody migration job tracking model.

### Phase 1: Abstraction Layer
1. Introduce `CustodyProvider` interface:
   - `createMerchantVault`
   - `createReceiveAddress`
   - `buildTransfer`
   - `submitTransfer`
   - `getTransferStatus`
   - `getAddressBalance`
2. Implement:
   - Legacy adapter (read/sweep only)
   - Managed MPC adapter (active path)
3. Route payout/consolidation through custody service, not direct key reads.

### Phase 2: Data Model Evolution
1. Add custody metadata tables:
   - `custody_vaults`
   - `custody_wallets`
   - `custody_migration_jobs`
   - `custody_signing_audit`
2. Keep old tables for compatibility during migration.
3. Stop creating new encrypted raw private keys for migrated merchants.

### Phase 3: New Merchant Cutover
1. New merchants are provisioned directly on managed MPC.
2. New receive addresses are MPC-owned per network.
3. UI/API expose active receive addresses and custody status.

### Phase 4: Existing Merchant Live Rekey
1. Create new MPC addresses per merchant/network.
2. Mark old addresses as `sweep_only`.
3. Freeze payout/consolidation writes during each merchant/network migration window.
4. Sweep balances, wait confirmations, flip active address.
5. Continue late-fund monitoring and residual auto-sweep.

### Phase 5: Legacy Decommission
1. Disable legacy signing path for migrated merchants.
2. Remove fallback key-derivation logic from runtime execution.
3. Retain historical/audit read paths through stability window, then cleanup.

## API and UX Additions
1. `GET /v1/merchants/{merchantId}/wallets` for active receive addresses and lifecycle state.
2. `GET /v1/merchants/{merchantId}/custody-migrations` for migration status.
3. Onboarding/settings should display custody provider state and migration banners.

## Acceptance Gates
1. Isolation: one merchant vault compromise cannot sign for another merchant.
2. Functional: onboarding, settlement, payout, consolidation succeed on MPC path.
3. Migration correctness: no lost funds, no double spend, ledger reconciliation stays consistent.
4. Resilience: retries/idempotency for provider failures; jobs resumable after crashes.
5. Audit: every signing action has durable trace metadata.

## Risks To Manage
1. In-flight settlements during migration windows.
2. Address rotation communication to merchants/integrators.
3. Provider outages and rate limits.
4. Rollback path for partial migration failures.

## Rollout Principle
Progressive rollout by merchant/network batches with explicit freeze windows and operational runbooks.
