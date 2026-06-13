# RailBridge Merchant OS (Working Prototype)

Merchant OS is the merchant-facing control plane for RailBridge.

It gives merchants a Stripe-like experience for stablecoin acceptance:

1. Define paid API routes/products.
2. Accept USDC from supported chains.
3. Track settlement lifecycle in one dashboard.
4. Request payouts without handling wallet keys.

## What Merchants Should And Should Not Do

Merchant responsibilities:

1. Build or update their backend paid routes.
2. Add RailBridge requirement resolution + payment middleware wiring.
3. Configure webhook endpoint(s).
4. Use Merchant Console for products, settlements, payouts, and keys.

RailBridge responsibilities:

1. Verify/settle payment flow (through payment middleware/facilitator layer).
2. Handle chain complexity and settlement lifecycle events.
3. Keep ledger + balance projection updated.
4. Deliver signed webhooks for payment/payout events.

Important: merchants should not manually call facilitator `/verify` or `/settle`.

## Product Simplicity Defaults

By default, product creation is abstraction-first:

1. `sourceNetwork` defaults to `any`.
2. Product can accept USDC from any active supported chain.
3. Settlement mode defaults to `cross_chain`.
4. Destination network can fall back to treasury policy.

Merchants can still use advanced routing controls when they want explicit source/destination behavior.

## Documentation Map

1. Demo runbook: `merchant-os/DEMO_GUIDE.md`
2. Beginner merchant integration guide (repo-free): `merchant-os/AGENT_INTEGRATION_GUIDE.md`
3. Merchant onboarding + integration technical guide: `merchant-os/ONBOARDING_TECHNICAL.md`
4. Webhook setup guide: `merchant-os/WEBHOOK_SETUP_GUIDE.md`
5. Reality status matrix: `merchant-os/REALITY_CHECK.md`
6. Architecture overview: `merchant-os/ARCHITECTURE.md`
7. Deep architecture diagrams: `merchant-os/ARCHITECTURE_DEEP_DIVE.md`
8. Runtime config guide: `merchant-os/config/README.md`
9. Thin SDK package: `packages/server-sdk/README.md`

## Local Run

1. Install dependencies:

```bash
npm --prefix merchant-os install
npm --prefix merchant-os/frontend install
```

2. Start API:

```bash
npm --prefix merchant-os run dev:api
```

3. Start frontend:

```bash
npm --prefix merchant-os run dev:web
```

Default URLs:

1. Merchant Console: `http://localhost:3000`
2. Merchant OS API: `http://localhost:4030`

## Runtime Config And Env

Merchant OS now uses:

1. `merchant-os/config/runtime-config.json` for non-sensitive, editable defaults.
2. `merchant-os/config/runtime-config.local.json` (optional, gitignored) for local overrides.
3. `merchant-os/.env` for secrets.

Primary secrets in `.env`:

1. `MERCHANT_OS_INGEST_TOKEN`
2. `MERCHANT_OS_INTERNAL_TOKEN`
3. `MERCHANT_OS_ADMIN_TOKEN`
4. `MERCHANT_OS_CUSTODY_MASTER_KEY`
5. `MERCHANT_OS_GAS_SPONSOR_PRIVATE_KEY` (optional)

`MERCHANT_OS_CUSTODY_MASTER_KEY` is mandatory; Merchant OS exits on startup if it is missing or invalid.

Generate platform tokens quickly:

```bash
npm --prefix merchant-os run tokens:generate
```

Frontend (`merchant-os/frontend/.env.local`):

1. `MERCHANT_OS_API_URL` (default `http://localhost:4030`)

Non-secret runtime values are read from JSON config only (`runtime-config.json` + `runtime-config.local.json`).

## API Surface (Current)

Session-auth onboarding/config endpoints (`Authorization: Bearer <sessionToken>`):

1. `POST /v1/auth/login`
2. `POST /v1/onboarding/start`
3. `GET /v1/onboarding/checklist`
4. `GET /v1/onboarding/settings`
5. `POST /v1/onboarding/api-keys`
6. `PATCH /v1/onboarding/api-keys/{apiKeyId}`
7. `POST /v1/onboarding/api-keys/{apiKeyId}/revoke`
8. `POST /v1/onboarding/webhooks`
9. `PATCH /v1/onboarding/webhooks/{webhookId}`
10. `DELETE /v1/onboarding/webhooks/{webhookId}`
11. `POST /v1/onboarding/webhooks/test`
12. `POST /v1/onboarding/products`

Merchant runtime endpoints (`x-railbridge-api-key: <apiKey>`):

1. `GET /v1/merchants/{merchantId}/balances`
2. `GET /v1/merchants/{merchantId}/settlements`
3. `GET /v1/merchants/{merchantId}/products`
4. `POST /v1/merchants/{merchantId}/products`
5. `PUT /v1/merchants/{merchantId}/products/{apiProductId}`
6. `DELETE /v1/merchants/{merchantId}/products/{apiProductId}`
7. `GET /v1/merchants/{merchantId}/consolidations`
8. `POST /v1/merchants/{merchantId}/consolidations`
9. `GET /v1/merchants/{merchantId}/payouts`
10. `POST /v1/merchants/{merchantId}/payouts`
11. `GET /v1/merchants/{merchantId}/settings`

Platform/internal endpoints (not merchant public integration contract yet):

1. `POST /v1/internal/requirements/resolve` (internal token, platform-to-platform)
2. `POST /v1/internal/events/settlements` (ingest token, platform-to-platform)

Merchant SDK resolver endpoint:

1. `POST /v1/sdk/requirements/resolve` (`x-railbridge-api-key`)

Ops/admin endpoints:

1. `GET /v1/chains`
2. `POST /v1/admin/chains/{network}/status` (admin token)

## Integration Note

`resolveRequirements(...)` now targets merchant-facing `POST /v1/sdk/requirements/resolve` using `x-railbridge-api-key`.

Merchant integrations no longer need to pass internal platform tokens or merchant/account IDs for requirement resolution.

## One-Command Backend Demo

```bash
npm --prefix merchant-os run demo:quick
```

This resets DB, starts API, ingests sample lifecycle events, runs sample operations, prints summary, and exits.

## Demo Webhook Receiver

To run a local demo merchant webhook receiver:

```bash
npm --prefix merchant-os run demo:webhook:service
```

See `merchant-os/WEBHOOK_SETUP_GUIDE.md` section `Local demo merchant webhook service` for full end-to-end verification steps.

## Facilitator Event Integration (Platform Side)

Facilitator should publish settlement lifecycle events to Merchant OS:

1. `MERCHANT_OS_EVENT_INGEST_URL=http://localhost:4030/v1/internal/events/settlements`
2. `MERCHANT_OS_INGEST_TOKEN=<same as Merchant OS ingest token>`
3. `MERCHANT_CONTEXT_MAP_JSON=<destinationAddress -> merchant/account mapping>`

This integration is platform-to-platform and is not a merchant onboarding action.
