# Merchant OS Reality Check

Last reviewed: 2026-05-19

This file is a plain-English status map of what is currently:

1. Working for real.
2. Working but config-dependent.
3. Simulated/mocked behavior.

## Quick Summary

1. Merchant onboarding/auth/API-key/webhook/product config flows are real and functional.
2. Payment lifecycle visibility is real only if facilitator publishes settlement events.
3. Balance display is mixed: onchain read when available, projected fallback when not.
4. Consolidation bridge has a real execution path and can run onchain when signer/RPC/gas/funds are configured.
5. Payouts now use a real onchain USDC transfer path when enabled, with timeline/webhook failure visibility.

## Feature Matrix

### 1) Onboarding + Auth

Status: Working (real app flow, DB-backed)

1. `POST /v1/onboarding/start` creates merchant/account/admin/wallet profiles/session/key.
2. `POST /v1/auth/login` validates PBKDF2 password hash and issues session + API key.

References:

1. `merchant-os/src/server.js`
2. `merchant-os/src/db.js`
3. `merchant-os/src/schema.sql`

### 2) API Key Management

Status: Working (real app flow)

1. Create key: `POST /v1/onboarding/api-keys`
2. Edit key: `PATCH /v1/onboarding/api-keys/:id`
3. Revoke key: `POST /v1/onboarding/api-keys/:id/revoke`

Safety checks implemented:

1. Role checks (`admin/finance`).
2. Cannot revoke last active key.
3. Cannot revoke last active admin key.

References:

1. `merchant-os/src/server.js`
2. `merchant-os/src/db.js`
3. `merchant-os/frontend/app/settings/page.js`

### 3) Webhooks

Status: Working (real HTTP delivery)

1. Webhook endpoints are stored with signing secret.
2. Delivery uses outbound `fetch(...)` and logs responses/errors.
3. Signature is HMAC SHA-256 over `timestamp + "." + body`.

References:

1. `merchant-os/src/webhookService.js`
2. `merchant-os/src/db.js`
3. `merchant-os/sdk/index.js` (`verifyWebhook`)

### 4) Product/Route Configuration

Status: Working (real DB config)

1. Product route definition is persisted and validated.
2. Products are used by requirements resolution endpoint.

References:

1. `merchant-os/src/server.js`
2. `merchant-os/src/db.js`
3. `merchant-os/frontend/app/products/page.js`

### 5) Requirements Resolution

Status: Working with merchant-facing + internal contracts

1. Merchant-facing endpoint: `POST /v1/sdk/requirements/resolve` (auth via `x-railbridge-api-key`).
2. Internal endpoint remains available: `POST /v1/internal/requirements/resolve` (internal token).
3. SDK helper targets the merchant-facing endpoint.

Why this matters:

1. Merchant integration no longer needs internal token or tenant IDs.
2. Platform integrations can still use the internal endpoint contract.

References:

1. `merchant-os/src/server.js`
2. `merchant-os/sdk/README.md`
3. `merchant-os/sdk/index.js`

### 6) Settlement Lifecycle + Timeline

Status: Real if wired to facilitator; simulated if only demo script is used

1. Merchant OS does not verify onchain payments itself.
2. It ingests settlement lifecycle events from facilitator/internal publisher.
3. Ingest path is idempotent and emits merchant webhooks (`payment.*`).

References:

1. `merchant-os/src/server.js` (`/v1/internal/events/settlements`)
2. `facilitator/src/services/merchantOsPublisher.ts`
3. `facilitator/src/facilitator-implementation.ts`

### 7) Balance Display

Status: Mixed real + projected fallback

1. Overview tries real onchain USDC/native RPC reads.
2. If RPC reads fail/timeout, app uses projected balances from settlement ledger.

References:

1. `merchant-os/src/onchain.js`
2. `merchant-os/src/server.js` (overview builder)
3. `merchant-os/src/db.js` (recompute balances)

### 8) Consolidation Bridge

Status: Config-dependent (real path implemented)

When enabled (`realConsolidationBridgeEnabled=true` in runtime config):

1. Uses Circle Bridge Kit path.
2. Performs gas and onchain preflight checks.
3. Runs async and persists lifecycle status (`submitted` -> `confirmed` / `failed` with tx hashes).

Current signer model for prototype:

1. Wallets with `mpc:*` references resolve to tenant-derived private keys from `MERCHANT_OS_CUSTODY_MASTER_KEY`.
2. Non-`mpc:*` references generate tenant custody keys that are encrypted at rest with `MERCHANT_OS_CUSTODY_MASTER_KEY`.
3. If required signer material is missing or invalid, bridge fails with explicit reason and remains visible in timeline.

References:

1. `merchant-os/src/server.js` (consolidations)
2. `merchant-os/src/consolidationBridgeService.js`
3. `merchant-os/src/db.js` (`getCustodyPrivateKeyByReference`)
4. `merchant-os/.env`
5. `merchant-os/config/runtime-config.json`

### 9) Payouts

Status: Config-dependent (real path implemented)

1. Payout request creates request -> `submitted`.
2. With `realPayoutsEnabled=true`, server executes real ERC20 USDC transfer and updates to:
   - `completed` with `txHash`, or
   - `failed` with `failReason`.
3. With `realPayoutsEnabled=false`, payout uses simulation fallback and marks `completed`.
4. `payout.completed` and `payout.failed` webhooks are emitted.

References:

1. `merchant-os/src/server.js` (payout handlers)
2. `merchant-os/frontend/app/payouts/page.js`

## Configuration Reality (Runtime Config + `.env`)

Notable current values:

1. Non-sensitive defaults live in `merchant-os/config/runtime-config.json`.
2. `merchant-os/config/runtime-config.local.json` can override those defaults per machine.
3. Secrets live in `merchant-os/.env`.
4. Ingest and internal tokens are separate controls (`MERCHANT_OS_INGEST_TOKEN`, `MERCHANT_OS_INTERNAL_TOKEN`).
5. Ingest endpoint accepts ingest-token and internal-token headers for compatibility.

References:

1. `merchant-os/src/config.js`
2. `merchant-os/config/runtime-config.json`
3. `merchant-os/config/README.md`
4. `merchant-os/.env`

## Practical Interpretation

If your question is "Can I demo the full merchant journey today?":

1. Yes for onboarding, key/webhook setup, route setup, payment lifecycle visibility, and dashboard operations.
2. Yes for bridge/payout UX and status lifecycle visibility.
3. Yes for real bridge/payout execution when config + signer + onchain funds are configured.
4. If those prerequisites are missing, flows fail explicitly with actionable reasons in API/timeline.

## Recommended Next Hardening

1. Make requirement resolver a public stable endpoint (non-demo namespace).
2. Replace shared prototype signer with production MPC signing service integration.
3. Move payout execution to durable background workers (matching bridge durability model).
4. Keep config split strict: non-sensitive in runtime config, secrets in `.env`.
