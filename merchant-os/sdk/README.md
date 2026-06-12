# RailBridge SDK Prototype Notes

Last reviewed: 2026-06-08

This folder contains internal prototype helper functions used by older RailBridge demos.

Canonical merchant integration package (thin SDK) now lives at:
1. `packages/server-sdk/`

## Important Status

This SDK directory is a prototype reference in this repository.

If you are an external merchant, use the thin SDK package:
1. `@railbridgeai/merchant-sdk` (`packages/server-sdk/`)

## Important Clarification

Do not treat the helpers in this folder as the public merchant SDK surface.

External merchants should use `@railbridgeai/merchant-sdk`, whose current public surface is:
1. `createRailbridge(...)`
2. `createRailbridgeFromEnv(...)`
3. `client.protect(...)`
4. `client.protectExpress(...)`
5. `client.webhooks.verify(...)`
6. `client.webhooks.express(...)`
7. `client.getOnboardingStatus(...)`

## Contract Guarantees To Depend On

When building merchant integrations, depend on API contract stability, not repository internals.

Recommended dependency surface:
1. Merchant-facing HTTP endpoints.
2. Stable headers (`x-railbridge-api-key`, webhook signature headers).
3. Event types (`payment.*`, `payout.*`, `webhook.test`).

## Example Import (SDK-first Merchant Integration)

```js
import {
  createRailbridgeFromEnv
} from "@railbridgeai/merchant-sdk";

const rb = createRailbridgeFromEnv(process.env);
```

This `merchant-os/sdk` folder remains available only for internal reference and legacy prototype helpers.
