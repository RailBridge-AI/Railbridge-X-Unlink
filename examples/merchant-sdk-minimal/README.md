# Merchant SDK Minimal Example

This is the smallest practical Express example for `@railbridgeai/merchant-sdk`.

It shows:
1. one protected route
2. one local bootstrap helper for Merchant OS
3. zero payment logic inside the business handler

## Files

1. `server.mjs` mounts a paid `GET /api/premium` route.
2. `bootstrap-local-merchant.mjs` creates or logs into a local Merchant OS merchant, ensures the paid product exists, and writes `.env.local`.
3. `.env.example` holds local bootstrap defaults.

## Local Run

From the repo root, start the local RailBridge services:

```bash
npm --prefix merchant-os run start:api
npm --prefix facilitator run dev
```

Then in this example directory:

```bash
cp .env.example .env
npm install
npm run bootstrap:local
npm start
```

Automated local smoke test from the repo root:

```bash
npm --prefix facilitator run test:merchant-sdk-minimal
```

That smoke test installs `express` plus the local SDK checkout from `packages/server-sdk`, then boots the example and runs a paid request through it.

The bootstrap step writes `.env.local` with:
1. `RB_ENV=local`
2. a generated `RB_API_KEY`
3. the app `PORT`

Once the server is running:

```bash
curl -i http://localhost:4025/api/premium
```

An unpaid request should return `402 Payment Required`.

```bash
curl http://localhost:4025/health
```

Expected health response:

```json
{"status":"ok","service":"merchant-sdk-minimal"}
```

## What The Merchant Actually Wires

The important integration is only this:

```ts
import { createRailbridgeFromEnv } from "@railbridgeai/merchant-sdk";

const rb = createRailbridgeFromEnv(process.env);

await rb.protectExpress(
  app,
  {
    apiId: "premium_api",
    method: "GET",
    path: "/api/premium",
  },
  async (_req, res) => {
    res.json({ ok: true });
  },
);
```

## Notes

1. In production or testnet, merchants should set `RB_API_KEY` and `RB_ENV` from their own environment or secret manager instead of using the local bootstrap script.
2. The local bootstrap helper is only for repo-level demos and smoke testing.
