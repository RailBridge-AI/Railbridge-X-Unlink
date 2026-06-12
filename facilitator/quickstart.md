# RailBridge Quickstart (Merchant SDK)

Last reviewed: 2026-06-12

This quickstart shows the current recommended merchant integration flow for RailBridge:

1. Create a paid product in Merchant OS.
2. Protect your backend route with `@railbridgeai/merchant-sdk`.
3. Let RailBridge handle requirement resolution, payment verification, and settlement wiring.

If you are integrating a merchant backend today, this SDK-first path should be your default. You should not manually wire facilitator `/verify` and `/settle` calls in normal merchant code.

## 1) Prerequisites

- Node.js 18+
- An Express backend
- A RailBridge merchant API key
- A paid product configured in Merchant OS for the route you want to protect

For local development inside this repo, you will also run:

- Merchant OS API
- Facilitator

## 2) Install the SDK

In your merchant backend:

```bash
npm install @railbridgeai/merchant-sdk
```

## 3) Set Environment Variables

For the normal hosted RailBridge flow, these are the main variables:

```env
RB_API_KEY=rb_...
RB_ENV=testnet
RB_WEBHOOK_SECRET=whsec_...
```

Environment values:

- `RB_API_KEY`: merchant runtime API key
- `RB_ENV`: `local`, `testnet`, or `live`
- `RB_WEBHOOK_SECRET`: only needed if you verify webhook signatures

Advanced overrides are optional:

```env
RB_MERCHANT_OS_URL=https://api.testnet.railbridge.ai
RB_FACILITATOR_URL=https://facilitator.testnet.railbridge.ai
```

Only set those when:

1. You are targeting local or self-hosted RailBridge services.
2. RailBridge support asked you to use non-standard endpoints.

## 4) Protect a Route

This is the core integration:

```ts
import express from "express";
import { createRailbridgeFromEnv } from "@railbridgeai/merchant-sdk";

const app = express();
const rb = createRailbridgeFromEnv(process.env);

const start = async () => {
  const premiumGate = await rb.protectExpress(
    app,
    {
      apiId: "premium_api",
      method: "GET",
      path: "/api/premium",
    },
    async (_req, res) => {
      // Keep your business logic here.
      res.json({
        ok: true,
        message: "premium content unlocked",
      });
    },
  );

  premiumGate.startAutoRefresh?.();

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  const port = Number(process.env.PORT || 4021);
  app.listen(port, () => {
    console.log(`merchant backend listening on http://localhost:${port}`);
  });
};

start().catch((error) => {
  console.error("failed to start merchant backend", error);
  process.exit(1);
});
```

What changed versus the older flow:

1. You no longer install and hand-wire the raw `@x402/*` server stack for the normal merchant path.
2. You no longer hardcode payment requirements in route middleware.
3. RailBridge resolves requirements from Merchant OS using your merchant API key.
4. Your handler stays focused on business logic.

## 5) Configure the Product in Merchant OS

Your protected route should match a product defined in Merchant OS.

Typical product fields:

1. `apiId`
2. `method`
3. `path`
4. `amountUsdc`
5. optional routing fields such as source network, settlement mode, and destination network

Important:

1. Product pricing and routing now live in Merchant OS, not in your route code.
2. Merchants should not call internal RailBridge endpoints from backend business logic.

## 6) Same-Chain vs Cross-Chain

The default pattern is to configure settlement behavior in Merchant OS.

If you need a route-level override, you can pass `settlementModeOverride`:

```ts
await rb.protectExpress(
  app,
  {
    apiId: "premium_api",
    method: "GET",
    path: "/api/premium",
    settlementModeOverride: "cross_chain",
  },
  premiumBusinessHandler,
);
```

Allowed values:

- `same_chain`
- `cross_chain`

Use overrides sparingly. In most cases, product configuration in Merchant OS should be the source of truth.

## 7) Add Webhook Verification

Webhooks are strongly recommended so your backend can react to async payment and payout events.

```ts
import express from "express";
import { createRailbridgeFromEnv } from "@railbridgeai/merchant-sdk";

const app = express();
const rb = createRailbridgeFromEnv(process.env);

app.use("/webhooks/railbridge", express.text({ type: "application/json" }));

app.post(
  "/webhooks/railbridge",
  rb.webhooks.express({
    secret: process.env.RB_WEBHOOK_SECRET,
    onEvent: async (event) => {
      console.log("railbridge webhook", event.type, event.id);
    },
  }),
);
```

Common event types:

1. `payment.settled_source`
2. `payment.bridge_pending`
3. `payment.bridge_confirmed`
4. `payment.failed`
5. `payout.completed`
6. `payout.failed`
7. `webhook.test`

## 8) Local Repo Quickstart

If you are working inside this repository, the fastest end-to-end local path is the minimal SDK example.

### 8.1 Install local dependencies

From the repo root:

```bash
npm --prefix merchant-os install
npm --prefix facilitator install
```

### 8.2 Start local RailBridge services

In separate terminals:

```bash
npm --prefix merchant-os run start:api
```

```bash
npm --prefix facilitator run dev
```

Default local service URLs:

- Merchant OS API: `http://localhost:4030`
- Facilitator: `http://localhost:4022`

### 8.3 Run the minimal merchant SDK example

From `examples/merchant-sdk-minimal`:

```bash
cp .env.example .env
npm install
npm run bootstrap:local
npm start
```

The bootstrap step will:

1. create or log into a local Merchant OS merchant
2. create an API key if needed
3. ensure the paid product exists
4. write `.env.local` with `RB_ENV=local` and `RB_API_KEY`

### 8.4 Verify the unpaid flow

```bash
curl -i http://localhost:4025/api/premium
```

Expected result: `402 Payment Required`

Health check:

```bash
curl http://localhost:4025/health
```

Expected response:

```json
{"status":"ok","service":"merchant-sdk-minimal"}
```

### 8.5 Run the repo smoke test

From the repo root:

```bash
npm --prefix facilitator run test:merchant-sdk-minimal
```

## 9) Hosted/Testnet Quickstart

For a hosted or testnet integration:

1. Create a merchant account in Merchant OS.
2. Create an API key.
3. Create a paid product for your backend route.
4. Set `RB_API_KEY` and `RB_ENV=testnet` in your app environment.
5. Mount `protectExpress(...)` on the route.
6. Register a webhook endpoint and set `RB_WEBHOOK_SECRET`.
7. Test an unpaid request first, then test a paid request from an x402-capable client.

Public testnet service URLs from this repo:

- Merchant OS web: `https://app.testnet.railbridge.ai`
- Merchant OS API: `https://api.testnet.railbridge.ai`
- Facilitator API: `https://facilitator.testnet.railbridge.ai`

## 10) Testing Your Integration

Minimum acceptance checks:

1. Unpaid request returns `402 Payment Required`.
2. Paid retry returns `200 OK` with your normal business payload.
3. Merchant OS shows the settlement lifecycle.
4. Your webhook endpoint receives and verifies a test event.
5. Your business logic does not contain payment-specific code.

## 11) Common Mistakes

1. Hardcoding route price and chain routing in application code instead of Merchant OS.
2. Calling facilitator `/verify` or `/settle` directly from merchant business handlers.
3. Parsing webhook JSON before preserving the raw body for signature verification.
4. Mixing payment logic into service-layer business code.
5. Setting custom endpoint overrides when `RB_ENV` would have been enough.

## 12) Where To Go Next

- Merchant integration guide: `../merchant-os/AGENT_INTEGRATION_GUIDE.md`
- Merchant SDK reference: `../packages/server-sdk/README.md`
- Minimal example: `../examples/merchant-sdk-minimal/README.md`
- Webhook guide: `../merchant-os/WEBHOOK_SETUP_GUIDE.md`
- Buyer flow: `QUICKSTART_CLIENT.md`
- Facilitator details: `README.md`
