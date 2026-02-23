# Merchant OS (Demo MVP)

Demo-first Merchant Treasury OS app for RailBridge.

## Scope

- Custodial-only model (RailBridge-managed wallets)
- USDC-only flows
- Web2 login
- Merchant/account scoped overview, settlements, policy, consolidation, payout endpoints

## Architecture

- `merchant-os/src/*`: Node API + demo data layer
- `merchant-os/frontend/*`: Next.js + React + Tailwind frontend

## Run (Local)

1. Install frontend dependencies:

```bash
cd merchant-os/frontend
npm install
```

2. Start API server (terminal 1):

```bash
cd merchant-os
npm run dev:api
```

3. Start Next.js frontend (terminal 2):

```bash
cd merchant-os
npm run dev:web
```

Frontend: `http://localhost:3000`
API: `http://localhost:4030`

Notes:
- API `/` redirects to `MERCHANT_OS_WEB_URL` (default `http://localhost:3000`).
- Frontend `/v1/*` requests are proxied to API via Next rewrites.
- Merchant OS API auto-loads `merchant-os/.env` when present (shell env vars still override it).

## Demo Credentials

Printed by the API server on startup. Default passwords are `demo123`.

## Optional Env Vars

API (`merchant-os/.env`):

- `MERCHANT_OS_PORT` (default `4030`)
- `MERCHANT_OS_WEB_URL` (default `http://localhost:3000`)
- `MERCHANT_OS_DB_PATH` (default `merchant-os/data/merchant-os.db`)
- `MERCHANT_OS_SESSION_HOURS` (default `24`)
- `MERCHANT_OS_INGEST_TOKEN` (default `merchant-os-demo-ingest`)
- `MERCHANT_OS_INTERNAL_TOKEN` (default same as ingest token)
- `MERCHANT_OS_FACILITATOR_ADDRESS` (required for cross-chain requirement resolution)
- `MERCHANT_OS_DEMO_SOURCE_NETWORK` (default `eip155:421614`, Arbitrum Sepolia)
- `MERCHANT_OS_ONCHAIN_TIMEOUT_MS` (default `7000`, per-network RPC timeout)
- `MERCHANT_OS_ONCHAIN_TOTAL_BUDGET_MS` (default `2200`, max total wait before overview returns partial/fallback balances)

RPC + USDC token metadata are hardcoded from a Circle-supported chain snapshot.
USDC allowlist for demo is auto-derived from those hardcoded token addresses plus `USDC` symbol, so no env var is required.

Frontend (`merchant-os/frontend/.env.local`):

- `MERCHANT_OS_API_URL` (default `http://localhost:4030`)

## Key Endpoints

- `POST /v1/demo/auth/login`
- `GET /v1/demo/meta/credentials`
- `GET /v1/demo/merchant/{merchantId}/accounts/{accountId}/overview`
- `GET /v1/demo/merchant/{merchantId}/accounts/{accountId}/settlements`
- `GET /v1/demo/merchant/{merchantId}/accounts/{accountId}/api-revenue`
- `GET /v1/demo/merchant/{merchantId}/accounts/{accountId}/api-products`
- `POST /v1/demo/merchant/{merchantId}/accounts/{accountId}/api-products`
- `PUT /v1/demo/merchant/{merchantId}/accounts/{accountId}/api-products/{apiProductId}`
- `PUT /v1/demo/merchant/{merchantId}/accounts/{accountId}/policy`
- `POST /v1/demo/merchant/{merchantId}/accounts/{accountId}/consolidations`
- `POST /v1/demo/merchant/{merchantId}/accounts/{accountId}/payouts`
- `POST /v1/demo/internal/events/settlements` (ingest token required)
- `POST /v1/demo/internal/requirements/resolve` (internal token required)

## One-Command Backend Demo

```bash
cd merchant-os
npm run demo:quick
```

This resets the DB, runs the API server, ingests sample settlement lifecycle events, applies a policy update, triggers consolidation, prints summary output, and exits.

## Facilitator Integration

In `facilitator/.env`, set:

- `MERCHANT_OS_EVENT_INGEST_URL=http://localhost:4030/v1/demo/internal/events/settlements`
- `MERCHANT_OS_INGEST_TOKEN=merchant-os-demo-ingest`
- `MERCHANT_CONTEXT_MAP_JSON` mapping merchant destination addresses to Merchant OS ids.

Example:

```json
{
  "0x1111111111111111111111111111111111118453": {
    "merchantId": "11111111-1111-4111-8111-111111111111",
    "accountId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  }
}
```
