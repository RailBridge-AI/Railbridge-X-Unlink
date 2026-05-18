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
  "onboardingAllowlistDomains": ["example.com"],
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

### 4) Register Webhook And Send Test Event

Optional: run in-repo demo webhook receiver in another terminal:

```bash
RB_WEBHOOK_REQUIRE_SIGNATURE=false npm --prefix merchant-os run demo:webhook:service
```

```bash
curl -s -X POST http://localhost:4030/v1/onboarding/webhooks \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"url":"http://localhost:4070/webhooks/railbridge"}' | jq

curl -s -X POST http://localhost:4030/v1/onboarding/webhooks/test \
  -H "authorization: Bearer $TOKEN" | jq
```

Inspect received events:

```bash
curl -s http://localhost:4070/events | jq
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
2. `Overview`
3. `Settlements`
4. `Products`
5. `Payouts`
6. `Settings`

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

1. `EVM_PRIVATE_KEY`
2. `EVM_RPC_URL`
3. `CROSS_CHAIN_ENABLED=true`
4. `MERCHANT_OS_EVENT_INGEST_URL=http://localhost:4030/v1/internal/events/settlements`
5. `MERCHANT_OS_INGEST_TOKEN=merchant-os-demo-ingest`
6. `FACILITATOR_ADMIN_TOKEN=facilitator-admin-token`
7. `RB_API_KEY=<merchant API key from onboarding/settings>`

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
   - set `onboardingAutoApprove=true` in runtime config
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
