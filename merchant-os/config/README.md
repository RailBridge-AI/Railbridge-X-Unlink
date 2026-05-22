# Merchant OS Runtime Config

Use this folder for non-sensitive Merchant OS configuration.

## Files

1. `runtime-config.json` (tracked): shared defaults for local/dev.
2. `runtime-config.local.json` (optional, gitignored): machine-specific overrides.
3. `.env`: secrets only.

## Precedence

Configuration is resolved in this order for non-secrets:

1. `runtime-config.json`
2. `runtime-config.local.json`

`runtime-config.local.json` overrides `runtime-config.json`.

## Keep In `.env`

1. Tokens (`MERCHANT_OS_INGEST_TOKEN`, `MERCHANT_OS_INTERNAL_TOKEN`, `MERCHANT_OS_ADMIN_TOKEN`)
2. Private keys (`MERCHANT_OS_CUSTODY_MASTER_KEY`, `MERCHANT_OS_GAS_SPONSOR_PRIVATE_KEY`)

`MERCHANT_OS_CUSTODY_MASTER_KEY` is required and startup fails fast if it is missing or invalid.
