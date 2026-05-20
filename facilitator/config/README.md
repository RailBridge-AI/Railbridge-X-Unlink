# Facilitator Runtime Config

Use this folder for non-sensitive facilitator configuration.

## Files

1. `runtime-config.json` (tracked): shared defaults for local/dev.
2. `runtime-config.local.json` (optional, gitignored): machine-specific overrides.
3. `payment-test-config.json` (tracked): non-sensitive defaults for payment smoke-test scripts.
4. `payment-test-config.local.json` (optional, gitignored): machine-specific script overrides.
5. `.env`: secrets and deployment overrides.

## Precedence

Configuration is resolved in this order:

1. `runtime-config.json`
2. `runtime-config.local.json`
3. Environment variables (`.env` or shell env)

The last source wins.

## Common Kill Switches (Non-sensitive)

Use JSON config for operational toggles that are not secrets:

1. `crossChainEnabled`: set `false` to pause cross-chain bridging.
2. `chainStatusOverrides`: set per-chain states (`active`, `degraded`, `paused`).

After editing JSON config, restart facilitator to apply changes.

## Payment Script Config

Use `payment-test-config.json` for non-sensitive smoke-test defaults (URLs, route hints, timeouts).

Current section:

1. `existingMerchantPayment`

## Keep In `.env`

1. `FACILITATOR_EVM_PRIVATE_KEY`
2. `CLIENT_PRIVATE_KEY`
3. API-keyed RPC URLs (if used) and private integrations
4. Operational tokens such as `MERCHANT_OS_INGEST_TOKEN`
