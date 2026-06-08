# @railbridgeai/merchant-sdk

Merchant-first server SDK for RailBridge.

Goal:
1. Protect paid routes with one middleware.
2. Keep merchant business logic unchanged.
3. Verify webhook signatures with one helper.

## Install

```bash
npm install @railbridgeai/merchant-sdk
```

Repo contributor note:
1. In this repository, `facilitator` consumes the SDK through a local `file:` dependency.
2. Running `npm --prefix facilitator install` also creates `packages/node_modules -> facilitator/node_modules` for local dependency resolution.
3. Use the facilitator npm scripts for local smoke tests; you do not need a separate `npm install` inside `packages/server-sdk` for the linked-package path.

Release workflow:
1. Bump the version in `packages/server-sdk/package.json`.
2. Push a tag like `sdk-v0.1.0-beta.1`.
3. GitHub Actions publishes the package to the npm registry as `public`.

## Quick Start (Express)

```ts
import express from "express";
import { createRailbridgeFromEnv } from "@railbridgeai/merchant-sdk";

const app = express();
const rb = createRailbridgeFromEnv(process.env);

const start = async () => {
  await rb.protectExpress(
    app,
    {
      apiId: "premium_api",
      method: "GET",
      path: "/api/premium",
    },
    async (req, res) => {
      // Keep business logic here.
      const payload = await buildPremiumPayload(req.user);
      res.json(payload);
    },
  );

  app.listen(4021);
};

start().catch(console.error);
```

Alternative env-first bootstrap:

```ts
import { createRailbridge } from "@railbridgeai/merchant-sdk";

const rb = createRailbridge({
  apiKey: process.env.RB_API_KEY,
  environment: "testnet",
});
```

In the normal hosted RailBridge flow, merchants should only need:
1. `RB_API_KEY`
2. `RB_ENV` (`local`, `testnet`, or `live`)

The SDK chooses RailBridge-managed URLs automatically from the environment.

## Webhook Verification

```ts
import express from "express";
import { createRailbridgeFromEnv } from "@railbridgeai/merchant-sdk";

const app = express();
const rb = createRailbridgeFromEnv(process.env);

// Keep raw payload for signature verification.
app.use("/webhooks/railbridge", express.text({ type: "application/json" }));

app.post(
  "/webhooks/railbridge",
  rb.webhooks.express({
    secret: process.env.RB_WEBHOOK_SECRET,
    onEvent: async (event) => {
      // idempotent async processing
      console.log("railbridge webhook", event.type, event.id);
    },
  }),
);
```

## Merchant Env Vars

```env
RB_API_KEY=rb_...
RB_WEBHOOK_SECRET=whsec_...
RB_ENV=testnet
```

Advanced overrides:

```env
RB_MERCHANT_OS_URL=https://api.testnet.railbridge.ai
RB_FACILITATOR_URL=https://facilitator.testnet.railbridge.ai
```

Only use these overrides if:
1. you are developing against local/self-hosted RailBridge services
2. RailBridge support asked you to target a non-standard endpoint

## API Summary

1. `createRailbridge(config)`
2. `createRailbridgeFromEnv(process.env)`
3. `client.protect(routeConfig)` -> Express middleware
4. `client.protectExpress(app, routeConfig, handler)` -> lowest-friction Express helper
5. `client.resolveRequirements(...)`
6. `client.webhooks.verify(...)`
7. `client.webhooks.express(...)`

## Notes

1. This SDK abstracts payment requirement resolution and verify/settle wiring.
2. Merchant handlers should only contain business logic.
3. Do not call RailBridge internal endpoints (`/v1/internal/*`) from merchant apps.
