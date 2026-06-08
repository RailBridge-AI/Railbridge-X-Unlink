# RailBridge Merchant Integration Guide (Beginner, Repo-Free)

Last reviewed: 2026-06-08

This guide is for merchant teams building APIs with business logic who want to monetize endpoints with RailBridge.

You do not need to understand blockchain internals.
You do not need access to the RailBridge repo.

## 1) What You Build vs What RailBridge Handles

Merchant team builds:
1. Your API endpoints and business logic.
2. A payment gate middleware in front of selected endpoints.
3. A webhook endpoint to receive settlement/payout updates.

RailBridge handles:
1. Payment requirement generation for each paid route.
2. Multi-chain payment verification and settlement flow.
3. Cross-chain lifecycle orchestration and status tracking.
4. Dashboarding in Merchant OS and signed webhook delivery.

## 2) Where Your Business Logic Should Go

Keep your business logic exactly where it already belongs: service layer / use-case layer.

Do not mix payment logic into your domain code.

Recommended structure:
1. `src/services/*` for business logic.
2. `src/integrations/railbridge/*` for payment/webhook adapter code.
3. `src/routes/*` only for wiring middleware + handlers.

Example route wiring:

```ts
import { createRailbridgeFromEnv } from "@railbridgeai/merchant-sdk";

const rb = createRailbridgeFromEnv(process.env);

await rb.protectExpress(
  app,
  {
    apiId: "premium_report_v1",
    method: "GET",
    path: "/api/premium-report",
  },
  async (_req, res) => {
    const report = await buildPremiumReport();
    return res.json(report);
  },
);
```

In short:
1. RailBridge gate decides "paid or not paid".
2. Your handler only does business work.

## 3) Do I Need the RailBridge Repo?

No.

You integrate through the SDK and hosted endpoints.

Recommended:
1. `npm install @railbridgeai/merchant-sdk`
2. Configure `RB_API_KEY`.
3. Set `RB_ENV` to `local`, `testnet`, or `live`.
4. Use `createRailbridgeFromEnv(...).protectExpress(...)` on paid routes.
5. Use `client.webhooks.express(...)` for webhook verification.

Public SDK:
1. `npm install @railbridgeai/merchant-sdk`
2. No registry auth is required for installation.

Minimum inputs for the most minimal paid-route integration:
1. `RB_API_KEY` (merchant runtime key).
2. `RB_ENV` (`local`, `testnet`, or `live`).
3. `RB_WEBHOOK_SECRET` only if you are verifying webhook signatures.

Additional inputs only if you call runtime/reporting APIs directly:
1. `merchantId` from onboarding or session responses.

Advanced overrides only:
1. `RB_MERCHANT_OS_URL`
2. `RB_FACILITATOR_URL`

## 4) Merchant-Facing API Contract (What You Depend On)

Public merchant-facing endpoints:
1. `POST /v1/sdk/requirements/resolve` with `x-railbridge-api-key`.
2. Runtime APIs (`/v1/merchants/{merchantId}/*`) with `x-railbridge-api-key`.
3. Onboarding/session APIs with `Authorization: Bearer <sessionToken>`.

Do not depend on internal endpoints in merchant code:
1. `/v1/internal/*`

Do not hand-code facilitator settlement logic in business handlers.

### 4.1 SDK-first route protection example

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
  premiumBusinessHandler,
);
```

Note:
1. RailBridge does not inject `req.user` for your application.
2. If your app already has auth/session middleware that sets `req.user`, you can keep using it inside your business handler.

## 5) Integration Flow (Simple)

1. Merchant creates a product in Merchant OS:
   - `apiId`, `method`, `path`, `amountUsdc`.
2. Merchant backend mounts payment gate middleware before the protected route.
3. Unpaid request returns `402 Payment Required` automatically.
4. Client/agent retries with payment proof.
5. Middleware verifies/settles, then your handler runs.
6. RailBridge sends async events to your webhook.

## 6) Product Setup Defaults (UX-Friendly)

For fastest integration, omit advanced routing fields initially.

If omitted:
1. `sourceNetwork` defaults to `any`.
2. `settlementMode` defaults to `cross_chain`.
3. Destination behavior follows policy fallback.

This lets merchants launch quickly without chain-by-chain config.

## 7) Minimal Adapter Responsibilities (If You Want Customization)

The SDK already handles these defaults. If you still build a custom adapter, keep it minimal:
1. Resolve route requirements from `POST /v1/sdk/requirements/resolve`.
2. Feed those requirements into your payment middleware.
3. Cache/refresh requirements periodically (for updated product config).

Everything else stays outside your business handlers.

## 8) Webhook Endpoint (Required for Good Ops UX)

Create one HTTPS endpoint:
1. `POST /webhooks/railbridge`

Verify signature using:
1. `x-railbridge-timestamp`
2. `x-railbridge-signature`
3. `HMAC_SHA256(secret, timestamp + "." + rawBody)`

Return `200` quickly, process async.

Expected events:
1. `payment.settled_source`
2. `payment.bridge_pending`
3. `payment.bridge_confirmed`
4. `payment.failed`
5. `payout.completed`
6. `payout.failed`
7. `webhook.test`

## 9) Environment Variables (Merchant Backend)

```env
RB_API_KEY=rb_live_or_testnet_key
RB_ENV=testnet
RB_WEBHOOK_SECRET=whsec_xxx
RB_SETTLEMENT_MODE_OVERRIDE=
RB_MAX_REQUIREMENT_OPTIONS=16
```

Advanced overrides only:

```env
RB_MERCHANT_OS_URL=https://api.testnet.railbridge.ai
RB_FACILITATOR_URL=https://facilitator.testnet.railbridge.ai
```

Notes:
1. Keep secrets in your own secret manager.
2. `RB_SETTLEMENT_MODE_OVERRIDE` is optional (`same_chain` or `cross_chain`).
3. `RB_MAX_REQUIREMENT_OPTIONS` is optional and caps how many payment options are returned in one challenge.
4. `RB_MERCHANT_OS_URL` and `RB_FACILITATOR_URL` are optional overrides, not normal merchant requirements.

## 10) Acceptance Checklist (Merchant POV)

1. `GET protected route` without payment returns `402`.
2. Paid retry returns `200` and your business payload.
3. Merchant OS timeline shows settlement lifecycle.
4. Webhook test event is received and signature-verified.
5. Your business logic file has zero payment-specific code.

## 11) Common Mistakes

1. Putting payment verification logic inside business services.
2. Calling internal RailBridge endpoints from merchant backend.
3. Parsing JSON before webhook signature check (must verify raw body).
4. Treating webhook as optional in production operations.
5. Hardcoding route price in code instead of using Merchant OS product config.

## 12) Practical Answer: "SDK or not?"

Use SDK-first.

Meaning:
1. Merchant code should depend on `@railbridgeai/merchant-sdk`, not raw endpoint orchestration.
2. SDK hides requirement resolution and verify/settle wiring.
3. HTTP contract remains the underlying platform contract, but merchant teams should not need to hand-wire it.
