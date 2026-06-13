# RailBridge Demo Guide

Last reviewed: 2026-05-19

This guide gives a repeatable demo flow for Merchant OS.

## Demo Paths

1. Quick Product Demo (recommended): fastest path to show onboarding, products, settlements, payouts, and webhooks.
2. Full x402 Integration Demo (optional): includes facilitator + merchant server + client payment flow.

## What This Demonstrates

1. Guided merchant onboarding.
2. API key + webhook setup.
3. Product creation with simplicity defaults.
4. Settlement lifecycle visibility.
5. Consolidation and payout operations.
6. Chain catalog auto-support visibility.

## Prerequisites

1. Node.js 18+ (`20+` recommended)
2. `npm`
3. `curl`
4. `jq`

Install dependencies:

```bash
npm --prefix merchant-os install
npm --prefix merchant-os/frontend install
```

## Frontend Calls vs Internal Calls

Use this section to know whether a command is simulating a browser action or exercising internal system wiring.

### Called by the frontend (merchant-facing)

1. `POST /v1/onboarding/start` (sign up + first session + default API key)
2. `GET /v1/onboarding/checklist`
3. `GET /v1/onboarding/settings`
4. `POST /v1/onboarding/api-keys`
5. `PATCH /v1/onboarding/api-keys/{keyId}`
6. `POST /v1/onboarding/api-keys/{keyId}/revoke`
7. `POST /v1/onboarding/webhooks`
8. `PATCH /v1/onboarding/webhooks/{webhookId}`
9. `DELETE /v1/onboarding/webhooks/{webhookId}`
10. `POST /v1/onboarding/webhooks/test`
11. `GET /v1/merchants/{merchantId}/balances`
12. `GET /v1/merchants/{merchantId}/settlements`
13. `GET /v1/merchants/{merchantId}/products`
14. `POST /v1/merchants/{merchantId}/products`
15. `PATCH /v1/merchants/{merchantId}/products/{productId}`
16. `DELETE /v1/merchants/{merchantId}/products/{productId}`
17. `POST /v1/merchants/{merchantId}/consolidations`
18. `GET /v1/merchants/{merchantId}/payouts`
19. `POST /v1/merchants/{merchantId}/payouts`

### Internal / demo-only / operator-facing

1. `POST /v1/internal/events/settlements`: internal settlement ingestion (facilitator or demo driver), not called by browser UI.
2. `POST /v1/admin/chains/{network}/status`: admin/operator control.
3. `POST /admin/chains/{network}/status` on facilitator: facilitator admin control.
4. `GET /health`, `GET /v1/chains`: diagnostics and operational visibility.
5. `npm --prefix merchant-os run demo:webhook:service`: demo receiver script (merchant-side local test helper).

Notes:

1. Most `curl` calls in this guide mirror what the frontend does.
2. The ingestion/admin endpoints above are intentionally outside normal merchant UI flows.

## A) Quick Product Demo (Recommended)

### 1) Configure Merchant OS

Use runtime config for non-sensitive settings and `.env` for secrets.

```bash
RB_CUSTODY_KEY=$(node -e "console.log('0x' + require('node:crypto').randomBytes(32).toString('hex'))")
cat > merchant-os/.env <<ENV
MERCHANT_OS_INGEST_TOKEN=merchant-os-demo-ingest
MERCHANT_OS_INTERNAL_TOKEN=merchant-os-demo-ingest
MERCHANT_OS_ADMIN_TOKEN=merchant-os-admin-token
MERCHANT_OS_CUSTODY_MASTER_KEY=$RB_CUSTODY_KEY
ENV
```

Create local non-sensitive overrides for reliable demo behavior:

```bash
cat > merchant-os/config/runtime-config.local.json <<'JSON'
{
  "onboardingAutoApprove": true,
  "onboardingAllowlistDomains": [],
  "realConsolidationBridgeEnabled": false,
  "realPayoutsEnabled": false
}
JSON
```

This keeps payouts and consolidations in simulation mode for deterministic local demos.

Reset DB for clean state:

```bash
npm --prefix merchant-os run db:reset
```

### 2) Start API and Frontend

Terminal A:

```bash
npm --prefix merchant-os run dev:api
```

Terminal B:

```bash
npm --prefix merchant-os run dev:web
```

Health checks:

```bash
curl -s http://localhost:4030/health | jq
curl -s http://localhost:4030/v1/chains | jq '.items | length'
```

### 3) Onboard Merchant

```bash
ONBOARD=$(curl -s -X POST http://localhost:4030/v1/onboarding/start \
  -H "content-type: application/json" \
  -d '{
    "merchantName":"Acme Labs",
    "adminEmail":"ops@acme.com",
    "adminPassword":"AcmeDemo123!",
    "complianceProfile":{"country":"US"}
  }')

echo "$ONBOARD" | jq
```

Export values:

```bash
TOKEN=$(echo "$ONBOARD" | jq -r '.token')
API_KEY=$(echo "$ONBOARD" | jq -r '.apiKey')
MERCHANT_ID=$(echo "$ONBOARD" | jq -r '.merchantId')
ACCOUNT_ID=$(echo "$ONBOARD" | jq -r '.accountId')
```

### 3.1) API Key Creation and Usage (Important)

What happens at onboarding:

1. `POST /v1/onboarding/start` automatically creates a default API key for the new merchant account.
2. That key is returned in onboarding response as `apiKey` (captured above as `API_KEY`).

How auth works:

1. Session token (`TOKEN`, sent as `Authorization: Bearer ...`) is for onboarding/admin console APIs:
   - `/v1/onboarding/*`
2. Merchant API key (`API_KEY`, sent as `x-railbridge-api-key`) is for merchant runtime APIs:
   - `/v1/merchants/{merchantId}/*`

Create an additional API key (same flow as Settings page):

```bash
curl -s -X POST http://localhost:4030/v1/onboarding/api-keys \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"name":"Backend Production Key","role":"admin"}' | jq
```

Important:

1. New key plaintext token is shown only at creation time; store it immediately.
2. You can later edit metadata or revoke keys from Settings (or onboarding key APIs), but you cannot re-read token plaintext later.

### 4) Register Webhook And Send Test Event

Optional: run in-repo demo webhook receiver in another terminal:

```bash
RB_WEBHOOK_REQUIRE_SIGNATURE=false npm --prefix merchant-os run demo:webhook:service
```

```bash
WEBHOOK_CREATE=$(curl -s -X POST http://localhost:4030/v1/onboarding/webhooks \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"url":"http://localhost:4070/webhooks/railbridge"}')

echo "$WEBHOOK_CREATE" | jq

WEBHOOK_SECRET=$(echo "$WEBHOOK_CREATE" | jq -r '.signingSecret')

curl -s -X POST http://localhost:4030/v1/onboarding/webhooks/test \
  -H "authorization: Bearer $TOKEN" | jq
```

Inspect received events:

```bash
curl -s http://localhost:4070/events | jq
```

Optional: rerun receiver with signature verification enabled:

```bash
RB_WEBHOOK_SECRET="$WEBHOOK_SECRET" RB_WEBHOOK_REQUIRE_SIGNATURE=true npm --prefix merchant-os run demo:webhook:service
```

Then send another test event:

```bash
curl -s -X POST http://localhost:4030/v1/onboarding/webhooks/test \
  -H "authorization: Bearer $TOKEN" | jq
```

### 5) Create Paid Product

```bash
curl -s -X POST "http://localhost:4030/v1/merchants/$MERCHANT_ID/products" \
  -H "x-railbridge-api-key: $API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "apiId":"premium_api",
    "apiName":"Premium API",
    "method":"GET",
    "path":"/api/premium",
    "amountUsdc":"0.01"
  }' | jq
```

Default behavior in this flow:

1. Accept from any supported source chain.
2. Use cross-chain settlement policy by default.

### 6) Simulate Settlement Lifecycle Events

`settled_source`:

```bash
curl -s -X POST http://localhost:4030/v1/internal/events/settlements \
  -H "x-merchant-os-ingest-token: merchant-os-demo-ingest" \
  -H "content-type: application/json" \
  -d "{
    \"eventId\":\"evt_demo_settled_1\",
    \"settlementId\":\"stl_demo_1\",
    \"merchantId\":\"$MERCHANT_ID\",
    \"accountId\":\"$ACCOUNT_ID\",
    \"sourceNetwork\":\"eip155:84532\",
    \"destinationNetwork\":null,
    \"asset\":\"USDC\",
    \"amount\":\"10000\",
    \"status\":\"settled_source\",
    \"txHash\":\"0x1111111111111111111111111111111111111111111111111111111111111111\",
    \"createdAt\":\"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\"
  }" | jq
```

Optional bridge lifecycle:

```bash
curl -s -X POST http://localhost:4030/v1/internal/events/settlements \
  -H "x-merchant-os-ingest-token: merchant-os-demo-ingest" \
  -H "content-type: application/json" \
  -d "{
    \"eventId\":\"evt_demo_bridge_pending_1\",
    \"settlementId\":\"stl_demo_1\",
    \"merchantId\":\"$MERCHANT_ID\",
    \"accountId\":\"$ACCOUNT_ID\",
    \"sourceNetwork\":\"eip155:84532\",
    \"destinationNetwork\":\"eip155:421614\",
    \"asset\":\"USDC\",
    \"amount\":\"10000\",
    \"status\":\"bridge_pending\",
    \"txHash\":\"0x2222222222222222222222222222222222222222222222222222222222222222\",
    \"createdAt\":\"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\"
  }" | jq
```

### 7) Validate Runtime APIs

```bash
curl -s "http://localhost:4030/v1/merchants/$MERCHANT_ID/balances" \
  -H "x-railbridge-api-key: $API_KEY" | jq

curl -s "http://localhost:4030/v1/merchants/$MERCHANT_ID/settlements" \
  -H "x-railbridge-api-key: $API_KEY" | jq '.items[:5]'

curl -s "http://localhost:4030/v1/merchants/$MERCHANT_ID/settings" \
  -H "x-railbridge-api-key: $API_KEY" | jq
```

### 8) Run Payout Test

```bash
curl -s -X POST "http://localhost:4030/v1/merchants/$MERCHANT_ID/payouts" \
  -H "x-railbridge-api-key: $API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "network":"eip155:84532",
    "amountUsdc":"0.01",
    "destinationAddress":"0x1234567890123456789012345678901234567890"
  }' | jq
```

In this demo flow, payouts are simulated (`realPayoutsEnabled=false`).

### 9) UI Walkthrough

Open `http://localhost:3000` and log in with:

1. Email: `ops@acme.com`
2. Password: `AcmeDemo123!`

Then show:

1. `Onboarding`
   - Step 4 now includes in-product backend integration guidance:
     - copyable backend snippet for `POST /v1/sdk/requirements/resolve`
     - copyable `curl` test
     - `Run integration check` button (validates API key + active product can resolve requirements)
2. `Overview`
3. `Settlements`
4. `Products`
5. `Payouts`
6. `Settings`

## Webhook Signature and Shared Secret Lifecycle

1. Secret creation:
   - When merchant creates endpoint (`POST /v1/onboarding/webhooks`), RailBridge generates a new endpoint-scoped signing secret (`whsec_...`).
2. Secret delivery to merchant:
   - Returned in that create response as `signingSecret`.
   - Also surfaced in frontend immediately after webhook creation so merchant can copy/store it.
   - Not returned in normal webhook list/read responses later, so merchant should store it at creation time.
3. Signature generation:
   - For every webhook delivery, RailBridge computes:
     `HMAC_SHA256(signingSecret, timestamp + "." + rawJsonBody)`
   - Sent in header `x-railbridge-signature`.
   - Timestamp sent in header `x-railbridge-timestamp`.
4. Merchant verification:
   - Merchant backend must verify signature using raw request body (not parsed/reformatted JSON), timestamp, and shared secret.
   - If verification fails, backend should return `401`.
5. Rotation:
   - Current practical rotation flow: create a new webhook endpoint (new `signingSecret`), update merchant backend secret, then disable/delete old endpoint.

## B) Full x402 Integration Demo (Optional)

Use this path when you want a live payment execution story.

### Extra Requirements

1. Funded testnet wallet keys for facilitator and client.
2. Testnet USDC and native gas.
3. Valid RPC endpoints.

### 1) Install facilitator deps

```bash
npm --prefix facilitator install
```

### 2) Configure facilitator

Set in `facilitator/.env`:

1. `FACILITATOR_EVM_PRIVATE_KEY`
2. Optional: `EVM_RPC_URL` (runtime override; defaults come from `facilitator/config/runtime-config.json`)
3. `MERCHANT_OS_EVENT_INGEST_URL=http://localhost:4030/v1/internal/events/settlements`
4. `MERCHANT_OS_INGEST_TOKEN=merchant-os-demo-ingest`
5. `FACILITATOR_ADMIN_TOKEN=facilitator-admin-token`
6. `RB_API_KEY=<merchant API key from onboarding/settings>`

Set cross-chain behavior in `facilitator/config/runtime-config.json`:

1. `"crossChainEnabled": true` to enable bridging
2. `"crossChainEnabled": false` to run same-chain only

### 3) Start services

Terminal A:

```bash
npm --prefix merchant-os run dev:api
```

Terminal B:

```bash
npm --prefix merchant-os run dev:web
```

Terminal C:

```bash
npm --prefix facilitator run dev
```

Terminal D:

```bash
npm --prefix facilitator run test:merchant-os-demo
```

Terminal E:

```bash
npm --prefix facilitator run example:client
```

Alternative (recommended): run one focused real payment smoke test script that logs in/onboards merchant, ensures product config, starts the Merchant OS demo merchant route, pays with `CLIENT_PRIVATE_KEY`, and checks that settlement appears in Merchant OS:

```bash
npm --prefix facilitator run test:accept-payment-merchant-os
```

Production-like split mode (merchant backend started separately):

Terminal D (merchant backend only):

```bash
RB_API_KEY=<merchant_api_key> RB_API_ID=premium_api PORT=4025 npm --prefix facilitator run test:merchant-os-demo
```

Terminal E (payer client only):

```bash
npm --prefix facilitator run test:accept-payment-existing-merchant-os
```

Optional settlement verification in split mode:

```bash
RB_API_KEY=<merchant_api_key> \
npm --prefix facilitator run test:accept-payment-existing-merchant-os
```

Non-sensitive split-mode settings live in:

1. `facilitator/config/payment-test-config.json`
2. Optional local override: `facilitator/config/payment-test-config.local.json`

The script auto-resolves merchant context and product route from Merchant OS using:

1. `GET /v1/sdk/context`
2. `GET /v1/merchants/{merchantId}/products`

Manual bridge is now separate. If you want a script utility for bridge API only:

```bash
npm --prefix facilitator run test:bridge-merchant-os
```

Important: even in this mode, verify/settle calls are performed by middleware/platform components, not hand-written merchant API calls.

## Chain Ops During Demo

List chains:

```bash
curl -s http://localhost:4030/v1/chains | jq '.items[] | {network,status,displayName}'
```

Pause chain in Merchant OS:

```bash
curl -s -X POST http://localhost:4030/v1/admin/chains/eip155:84532/status \
  -H "authorization: Bearer merchant-os-admin-token" \
  -H "content-type: application/json" \
  -d '{"status":"paused"}' | jq
```

Facilitator chain status:

```bash
curl -s -X POST http://localhost:4022/admin/chains/eip155:84532/status \
  -H "authorization: Bearer facilitator-admin-token" \
  -H "content-type: application/json" \
  -d '{"status":"paused"}' | jq
```

## Troubleshooting

1. Port conflicts:

```bash
lsof -i :4030
lsof -i :3000
lsof -i :4022
```

2. Onboarding blocked by allowlist:
   - leave `onboardingAllowlistDomains` empty for open signup
   - or set `onboardingAutoApprove=true` in runtime config
   - or include your email domain in `onboardingAllowlistDomains`

3. Consolidation/payout failures:
   - confirm source balance, chain status, and gas prerequisites
   - use simulation mode for quick demo reliability (`realConsolidationBridgeEnabled=false` / `realPayoutsEnabled=false`)

4. No webhook events:
   - validate endpoint reachability
   - run webhook test endpoint
   - check signature verification logic

## Cleanup

```bash
npm --prefix merchant-os run db:reset
```
