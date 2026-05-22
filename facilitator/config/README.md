# Facilitator Runtime Config

Use this folder for non-sensitive facilitator configuration.

## Files

1. `runtime-config.json` (tracked): shared defaults for local/dev.
2. `runtime-config.local.json` (optional, gitignored): machine-specific overrides.
3. `runtime-config.local.example.json` (tracked): example local override template.
4. `payment-test-config.json` (tracked): non-sensitive defaults for payment smoke-test scripts.
5. `payment-test-config.local.json` (optional, gitignored): machine-specific script overrides.
6. `.env`: secrets only.

## Precedence

Configuration is resolved in this order for non-secrets:

1. `runtime-config.json`
2. `runtime-config.local.json`

`runtime-config.local.json` overrides `runtime-config.json`.

## Common Kill Switches (Non-sensitive)

Use JSON config for operational toggles that are not secrets:

1. `crossChainEnabled`: set `false` to pause cross-chain bridging.
2. `chainStatusOverrides`: set per-chain states (`active`, `degraded`, `paused`).
3. `rpcOverridesByNetwork`: set explicit per-chain RPC endpoint lists.
4. `bridgeWorkerIntervalMs`, `bridgeRetryBaseMs`, `bridgeMaxAttempts`, `chainSyncMs`: worker/sync tuning.
5. `evmMaxFeePerGasWei`, `evmMaxPriorityFeePerGasWei`: optional gas fee floor tuning.

After editing JSON config, restart facilitator to apply changes.

## Payment Script Config

Use `payment-test-config.json` for non-sensitive smoke-test defaults (URLs, route hints, client pay-network choices, timeouts).

Current section:

1. `existingMerchantPayment`

Useful keys inside `existingMerchantPayment`:

1. `sourceNetwork`: fallback network if facilitator `/supported` is unavailable.
2. `preferredPayNetworks`: ordered list of client pay attempts for smoke tests, for example Base Sepolia then Arbitrum Sepolia.
3. `verifySettlement`: whether the script should also observe Merchant OS after each payment.

## Keep In `.env`

1. `FACILITATOR_EVM_PRIVATE_KEY`
2. `FACILITATOR_ADMIN_TOKEN`
3. `MERCHANT_OS_INGEST_TOKEN`
4. `CLIENT_PRIVATE_KEY` (for local client-example scripts)
