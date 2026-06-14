# RailBridge Private Treasury Implementation Plan

Last updated: 2026-06-13

Companion design document:

- `facilitator/documentation/PRIVATE_TREASURY_ARCHITECTURE.md`
- `facilitator/documentation/PRIVATE_TREASURY_MICRO_SPEC.md`

## Purpose

This document turns the private treasury architecture into an implementation plan for this repository.

It answers two practical questions:

1. what should RailBridge build first
2. which modules and files should change in each step

## Scope decision

The first implementation target should be:

- merchant treasury privacy first
- same-environment private treasury first
- one EVM Unlink environment first
- no payer-side privacy requirement for the MVP
- do not block payments when privacy is unavailable; downgrade to `public_fallback` instead

Recommended first private environment:

- `base-sepolia`

Why:

- the current RailBridge stack is EVM-first
- Merchant OS payout and balance code is already EVM-oriented
- the facilitator currently settles EVM `exact` x402 flows
- this keeps the first milestone aligned with the current codebase instead of forcing an Arc-specific payment flow into the MVP

## What the MVP should do

For a merchant account in `private` treasury mode:

1. Merchant OS resolves a payment requirement whose public `payTo` points to a RailBridge-controlled intake wallet on the selected source network.
2. The facilitator verifies and settles the x402 payment publicly into the RailBridge intake wallet.
3. Merchant OS records a pending private treasury credit for the merchant account.
4. A treasury sweep worker deposits pooled funds into RailBridge's omnibus Unlink account on that same environment.
5. RailBridge transfers funds privately inside Unlink from the omnibus account to the merchant's private Unlink account.
6. Merchant OS shows:
   - pending public intake
   - pending sweep
   - private available balance
7. Merchant payout requests in private mode become queued private withdrawals instead of immediate ERC-20 transfers from merchant custody wallets.

This is enough to prove merchant treasury privacy without solving cross-chain private routing yet.

Important product rule for the MVP:

- private-mode merchants should still be able to accept payments that cannot be routed privately
- the system should compute the actual privacy coverage for each requirement at resolution time
- if a route cannot be fulfilled privately, the requirement should resolve as `public_fallback` instead of being rejected

## Explicit non-goals for the first milestone

Do not include these in the first implementation:

- private cross-chain routing between Unlink environments
- private handling for unsupported source chains
- payer-side privacy for x402 funding
- full Arc Testnet integration
- production-grade compliance and reconciliation tooling

## Current system constraints

The current codebase has several assumptions that private treasury mode must replace:

- requirement resolution leaks `merchantId` and `accountId` in client-visible metadata
- same-chain payments often resolve directly to merchant custody wallets
- balance APIs merge projected ledger data with public RPC wallet reads
- payout execution assumes direct ERC-20 transfers from merchant custody wallets
- settlement ingest assumes public chain traces are the main accounting surface

Key current files:

- `merchant-os/src/services/requirementsResolverService.js`
- `merchant-os/src/server.js`
- `merchant-os/src/schema.sql`
- `merchant-os/src/db.js`
- `merchant-os/src/onchain.js`
- `merchant-os/src/usdcTransferService.js`
- `facilitator/src/facilitator-implementation.ts`
- `facilitator/src/services/merchantOsPublisher.ts`

## Integration prerequisites

Before implementation starts, RailBridge should explicitly prepare the Unlink integration surface in `merchant-os`.

### SDK dependency

Add the Unlink SDK to:

- `merchant-os/package.json`

Install:

```bash
npm --prefix merchant-os install @unlink-xyz/sdk
```

`viem` is already present in `merchant-os`, so no additional EVM client package is needed for the first pass.

### Backend-only integration

For the first private treasury MVP, Unlink should be integrated on the backend only.

Needed in phase 1:

- Unlink backend SDK usage in `merchant-os`
- RailBridge-held omnibus account material
- RailBridge-held merchant private account material if the platform is custodial
- backend registration, authorization, private transfers, withdrawals, and reads

Not needed in phase 1:

- browser-side Unlink SDK wiring
- browser token mint routes
- browser registration routes
- payer-side private x402 funding flow

### Intake wallet ownership model

For the first MVP, RailBridge should own the public intake EVM wallets, but the treasury side of the platform should control the signing keys.

Recommendation:

- RailBridge owns the intake wallets
- `merchant-os` treasury logic manages intake wallet key material
- the facilitator uses the intake wallet addresses for settlement routing, but does not become the long-term owner of treasury signing keys

This keeps public settlement routing in the facilitator while keeping treasury control closer to the private ledger, sweep logic, and payout logic.

### Required secrets and config

For the first MVP, plan for these environment variables or config entries in `merchant-os`:

- `UNLINK_API_KEY`
- `UNLINK_ENGINE_URL`
- `UNLINK_DEFAULT_ENVIRONMENT`
- `UNLINK_ENABLED`
- `TREASURY_INTAKE_PRIVATE_KEY_BASE_SEPOLIA`
- `UNLINK_OMNIBUS_MNEMONIC_BASE_SEPOLIA`

Likely later, once multiple environments are supported:

- `UNLINK_OMNIBUS_MNEMONIC_ETHEREUM_SEPOLIA`
- `UNLINK_OMNIBUS_MNEMONIC_MONAD_TESTNET`
- environment-to-network mapping config

### SDK surface decision

The current Unlink docs show two slightly different SDK shapes:

- `@unlink-xyz/sdk/server` in the quickstart
- `@unlink-xyz/sdk/admin` plus `@unlink-xyz/sdk/client` in the custody-model docs

Before building the full treasury adapter, RailBridge should do a small spike to confirm which current SDK surface it wants to standardize on in this repo.

Recommendation:

- keep all Unlink integration in `merchant-os`
- do not add the Unlink SDK to `facilitator` for the first same-environment treasury MVP
- build the provider abstraction in `merchant-os/src/privacyVaultService.js`

## Workstreams

The implementation breaks into six workstreams:

1. policy and tenant settings
2. opaque settlement context and requirement resolution
3. private account and ledger services
4. settlement ingest and sweep execution
5. private payout flow
6. UI and operational visibility

## Step 1: add treasury mode and privacy policy

Before changing payment routing, private treasury must become a first-class merchant account setting.

### Add policy fields

Add fields to the merchant policy model for:

- `treasuryMode`: `public` or `private`
- `privateHomeNetwork`
- `privacyEnabledAt`

`privacyCoverageMode` should not be stored as merchant policy.

It should be computed at requirement-resolution time and read time from:

- merchant policy
- source network
- private home network
- current Unlink environment support

### Update these files

- `merchant-os/src/schema.sql`
- `merchant-os/src/db.js`
- `merchant-os/src/server.js`
- `merchant-os/frontend/app/settings/page.js`

### Deliverable

Merchant OS can save and return a privacy treasury policy, but all runtime behavior still stays public.

## Step 2: replace leaked merchant metadata with an opaque payment context

This is the most important backend change.

Today Merchant OS injects merchant identifiers into resolved requirement metadata and the facilitator reads them back later. Private mode should stop doing that.

### Add a payment context record

Create a new table such as:

- `payment_requirement_contexts`

Suggested columns:

- `id`
- `payment_context_id`
- `merchant_id`
- `account_id`
- `api_product_id`
- `treasury_mode`
- `source_network`
- `destination_network`
- `scheme`
- `asset`
- `amount`
- `public_pay_to`
- `created_at`
- `expires_at`
- `status`
- `settled_at`
- `consumed_at`

### New behavior

- Merchant OS creates a `paymentContextId` when resolving a private-mode requirement.
- The requirement payload includes the opaque `paymentContextId`, not `merchantId` and `accountId`.
- The facilitator publishes settlement events using the opaque `paymentContextId`.
- Merchant OS resolves the `paymentContextId` back to the merchant account internally.

### Important design rule

`paymentContextId` is not an auth token or bearer credential.

It should be treated as:

- an opaque correlation id
- safe to expose in the off-chain payment flow
- non-secret by itself
- short-lived
- one-time use once a payment is settled

It should not:

- embed `merchantId`, `accountId`, route names, or other meaningful identifiers
- be reused across many payments for the same merchant or route
- be treated as authorization for any unrelated API operation

### Attribution integrity

To keep payment attribution correct, `paymentContextId` should be bound to the exact requirement that Merchant OS issued.

At minimum, Merchant OS should validate that the consumed context still matches:

- merchant account
- scheme
- source network
- asset
- amount
- public `payTo`

This protects against context reuse, replay, and accidental misattribution across merchants or products.

### Update these files

- `merchant-os/src/services/requirementsResolverService.js`
- `merchant-os/src/schema.sql`
- `merchant-os/src/db.js`
- `facilitator/src/facilitator-implementation.ts`
- `facilitator/src/services/merchantOsPublisher.ts`

### Deliverable

Private-mode settlements can be attributed to the correct merchant account without exposing merchant identifiers in client-visible requirement metadata.

## Step 3: create a privacy vault abstraction

Add one service boundary for all Unlink-specific behavior before wiring workers or payout logic.

### New module

Create:

- `merchant-os/src/privacyVaultService.js`

### Responsibilities

- ensure one RailBridge omnibus Unlink account per supported environment
- ensure one merchant private Unlink account per merchant account per supported environment
- register accounts using Unlink's custodial server model
- issue or refresh authorization as needed
- read private balances
- submit private transfers
- submit withdrawals

For the MVP, merchant private Unlink accounts should be individually generated and persisted per merchant account per supported environment.

Do not make a custom deterministic RailBridge seed hierarchy a prerequisite for phase 1 unless the Unlink SDK/account model is later verified to support that cleanly.

### Supporting config and docs

Update:

- `merchant-os/src/config.js`
- `merchant-os/config/README.md`

Suggested config fields:

- `unlinkEnabled`
- `unlinkEnvironmentByNetwork`
- `unlinkAdminApiKeyByEnvironment`
- `unlinkOmnibusMnemonicByEnvironment`
- `unlinkSweepPollIntervalMs`

### Deliverable

Merchant OS has a clean abstraction layer for Unlink and does not spread provider-specific logic across `server.js`.

## Step 4: add a private treasury ledger

Private mode cannot rely on public wallet balances as the primary source of truth.

### Add tables

Suggested tables:

- `private_accounts`
- `private_ledger_entries`
- `private_balance_snapshots`
- `omnibus_sweeps`
- `private_transfers`
- `withdrawal_batches`

Suggested provider-tracking fields on the private movement tables:

- `unlink_environment`
- `unlink_tx_id`
- `unlink_tx_hash`
- `provider_status`
- `provider_error_code`
- `provider_error_message`

### Suggested ledger events

- `payment.settled_public_intake`
- `omnibus.sweep_submitted`
- `omnibus.sweep_confirmed`
- `merchant.private_credit`
- `merchant.withdrawal_requested`
- `merchant.withdrawal_submitted`
- `merchant.withdrawal_confirmed`

### Update these files

- `merchant-os/src/schema.sql`
- `merchant-os/src/db.js`
- `merchant-os/src/server.js`

### Required balance branch

For `public` mode:

- keep the current overview path

For `private` mode:

- stop treating public wallet reads as the primary merchant balance
- return private ledger balances first
- keep public intake balances and public intake tx hashes as optional audit detail
- store and return Unlink operation references such as `unlink_tx_id` and `unlink_tx_hash` when the provider returns them

Important history rule:

- do not assume a private transfer means "no tx hash exists"
- Unlink private transfers and withdrawals may still return transaction references
- those references should be treated as operational and audit handles, not as proof that merchant-level sender, recipient, and amount attribution is public

### Deliverable

Merchant OS can return a real private-mode balance view even before private withdrawals are complete.

## Step 5: branch requirement resolution by treasury mode

Once policy and opaque context exist, requirement resolution should branch by treasury mode.

### Public mode

- preserve current behavior

### Private mode

- resolver computes privacy coverage on the spot for each requirement
- same-environment private payments should resolve to RailBridge intake, not merchant custody
- cross-chain private routing should remain out of scope for the first milestone
- if a route cannot be fulfilled privately, it should still resolve and be labeled `public_fallback`
- `payTo` should be the RailBridge intake wallet for the selected route when private routing is available

For the first MVP, the simplest `full_private` case is:

- merchant `privateHomeNetwork` is `base-sepolia`
- source network is `base-sepolia`

Other private-mode merchant routes should remain payable, but may downgrade to `public_fallback` until additional environments or hybrid routing logic are implemented.

### Update these files

- `merchant-os/src/services/requirementsResolverService.js`
- `merchant-os/src/server.js`
- `packages/server-sdk/src/index.js`
- `packages/server-sdk/src/paymentGuard.js`

The SDK should ideally require no merchant-side API changes. If the opaque settlement context stays inside requirement metadata, the merchant integration contract can remain stable.

### Deliverable

Merchants in private mode receive a different routing path without changing their own middleware integration, and routes that cannot be fulfilled privately still remain payable via `public_fallback`.

## Step 6: change settlement ingest to create pending private credits

After public settlement, Merchant OS should create a pending private treasury record instead of treating the merchant as directly paid on-chain.

### New ingest behavior

For private-mode context ids:

1. store settlement event as public intake
2. create pending ledger credit
3. mark the credit ready for sweep

For public mode:

- preserve current behavior

### Update these files

- `merchant-os/src/server.js`
- `merchant-os/src/db.js`
- `facilitator/src/services/merchantOsPublisher.ts`

### Deliverable

Private-mode settlements show up as pending credits waiting for omnibus sweep.

## Step 7: add a same-environment sweep worker

The first private treasury worker should stay in Merchant OS because it is treasury-accounting logic, not payment-verification logic.

### New modules

Create:

- `merchant-os/src/privacySweepWorker.js`
- `merchant-os/src/privacySweepService.js`

### Responsibilities

- find pending public-intake credits
- aggregate eligible amounts by environment
- deposit pooled funds into the RailBridge omnibus Unlink account
- confirm sweep completion
- transfer balances privately to merchant Unlink accounts
- append ledger entries for each step

### Deliverable

RailBridge can move from public intake to private merchant balance on one supported environment.

## Step 8: branch payout execution by treasury mode

Current payouts are direct ERC-20 transfers from merchant custody wallets. That should remain the public-mode path only.

### Public mode

- preserve current `transferUsdcOnchain(...)` execution

### Private mode

- create a withdrawal request
- reserve the private balance
- batch private withdrawals by environment
- submit public withdrawal to the merchant's destination address
- update ledger and payout status after confirmation

### Update these files

- `merchant-os/src/server.js`
- `merchant-os/src/usdcTransferService.js`

### New module

Create:

- `merchant-os/src/privatePayoutService.js`

### Deliverable

Private-mode payouts no longer imply direct public transfers from merchant custody wallets.

## Step 9: update Merchant OS UI after the backend states exist

Do this only after the private ledger states are real.

### Update these files

- `merchant-os/frontend/app/overview/page.js`
- `merchant-os/frontend/app/settlements/page.js`
- `merchant-os/frontend/app/payouts/page.js`
- `merchant-os/frontend/app/settings/page.js`

### UI behavior

Overview should show:

- private available balance
- pending sweep balance
- pending withdrawal balance

Settlements should:

- show public intake clearly
- show the public intake transaction hash when one exists
- show private sweep and private transfer references separately when available
- de-emphasize public explorer links for private internal steps

Payouts should:

- show queued withdrawal state
- show Unlink withdrawal `txId` and `txHash` when available for status tracking
- explain that private-mode payouts are batched and may not be immediate

History rows should distinguish at least:

- `public_intake`
- `private_sweep`
- `private_transfer`
- `private_withdrawal`

This keeps transaction history useful for operations without implying that private-mode internal movements have no transaction reference at all.

### Deliverable

Merchants can understand where funds are in the private treasury lifecycle.

## Step 10: cross-chain privacy only after same-environment private treasury works

Cross-chain private treasury is a second phase.

Do not begin this until Steps 1 through 9 are working.

When the time comes, the likely modules are:

- `facilitator/src/services/bridgeJobWorker.ts`
- `facilitator/src/services/bridgeJobStore.ts`
- `facilitator/src/services/circleCCTPBridgeService.ts`
- new Merchant OS treasury workers for public-to-private and private-to-public transitions

The key rule should remain:

- private inside one supported Unlink environment
- public while bridging between environments
- private again only after funds re-enter a supported Unlink environment

## Should RailBridge privatize the funding of the x402 call too?

Short answer:

- not for the first private treasury implementation

## Why not

RailBridge's primary privacy problem is merchant treasury attribution, not payer funding attribution.

Private treasury mode already improves the main leak by changing the public chain view from:

- payer -> merchant treasury

to:

- payer -> RailBridge intake

That breaks the clean public revenue trail to a merchant treasury wallet without requiring payer-side privacy.

## What the Unlink x402 tutorial is solving

The Unlink partner integration tutorial demonstrates a different privacy goal:

- fund a private Unlink balance
- withdraw a smaller amount to a payer EOA
- use that EOA to pay an x402 resource through Circle Gateway

That helps reduce the link between:

- the user's original funding wallet
- the final x402 payer EOA

This is payer privacy, not merchant treasury privacy.

## When payer privacy becomes worth doing

Payer-side privacy becomes worth doing when RailBridge wants one of these:

- a flagship privacy demo on Arc Testnet
- privacy-preserving buyer flows for agent wallets
- a future product where RailBridge helps both sides of the transaction preserve privacy

## Why it should stay out of the MVP

It should stay out of the first implementation because:

- the current RailBridge codebase is EVM-first, while the documented x402 private payment tutorial is Arc-specific
- the payer EOA flow depends on Circle Gateway and buyer-side wallet behavior that Merchant OS does not control
- it does not solve the core merchant treasury privacy problem
- it adds a second privacy product surface before the first one is stable

## Best sequencing

Best sequencing:

1. implement merchant treasury privacy first
2. validate private treasury balances and withdrawals on one EVM Unlink environment
3. add an Arc-based payer privacy demo later as a separate track

## Suggested PR sequence

### PR 1

- add `treasuryMode` policy fields
- add settlement context table
- update settings API and UI

### PR 2

- branch requirement resolution by treasury mode
- remove leaked merchant metadata from private-mode requirements
- update facilitator settlement attribution to use opaque context ids

### PR 3

- add `privacyVaultService`
- add private ledger tables and DB helpers
- add private-mode balances response branch

### PR 4

- add sweep worker
- add pending credit -> sweep -> private credit flow
- update overview and settlements UI

### PR 5

- add private payout request and withdrawal batching
- update payout UI

## Acceptance criteria for the first milestone

The first private treasury milestone is done when:

1. a merchant account can enable `private` treasury mode
2. Merchant OS resolves a private-mode requirement to a RailBridge intake wallet
3. the facilitator settles a public payment and Merchant OS attributes it without leaked merchant metadata
4. Merchant OS records the payment as pending private treasury
5. a sweep moves funds into a RailBridge omnibus Unlink account
6. a private transfer credits the merchant's private Unlink account
7. the Merchant OS overview shows a private available balance
8. a private-mode payout request becomes a queued withdrawal instead of an immediate merchant-wallet transfer
9. settlements and payouts history show the right public and private transaction references without leaking merchant attribution through requirement metadata

## Recommended first files to patch

If implementation starts immediately, the first files to patch should be:

- `merchant-os/src/schema.sql`
- `merchant-os/src/db.js`
- `merchant-os/src/services/requirementsResolverService.js`
- `merchant-os/src/server.js`
- `facilitator/src/facilitator-implementation.ts`
- `facilitator/src/services/merchantOsPublisher.ts`
