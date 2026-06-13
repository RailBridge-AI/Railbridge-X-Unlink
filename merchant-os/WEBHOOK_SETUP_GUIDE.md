# RailBridge Webhook Setup Guide

Last reviewed: 2026-05-17

This guide explains exactly what webhook URL merchants should enter and how to set up a secure webhook receiver.

Webhook setup is not a hard blocker for basic payment acceptance, but it is strongly recommended.

If webhook is not configured, payments can still settle, but merchant operations become blind to async status changes unless they poll APIs.

## 1) What URL should I enter?

Enter your backend callback endpoint URL that accepts `POST` requests from RailBridge.

Correct examples:

1. `https://api.yourcompany.com/webhooks/railbridge`
2. `https://app.yourcompany.com/api/webhooks/railbridge`

Avoid these:

1. Frontend page URLs like `https://app.yourcompany.com/settings`
2. Internal localhost URLs without a public tunnel
3. Merchant OS API URLs

## 2) What does RailBridge send?

RailBridge sends a JSON payload with headers:

1. `x-railbridge-event`
2. `x-railbridge-event-id`
3. `x-railbridge-timestamp`
4. `x-railbridge-signature`

Signature model:

1. `signature = HMAC_SHA256(signingSecret, timestamp + "." + rawBody)`

## 3) Event types you should handle

1. `payment.settled_source`
2. `payment.bridge_pending`
3. `payment.bridge_confirmed`
4. `payment.failed`
5. `payout.completed`
6. `payout.failed`
7. `webhook.test`

## 4) Express example

```js
import express from "express";
import { verifyWebhook } from "@railbridgeai/merchant-sdk";

const app = express();

// Keep raw JSON string for signature verification
app.use("/webhooks/railbridge", express.text({ type: "application/json" }));

app.post("/webhooks/railbridge", (req, res) => {
  const signature = req.header("x-railbridge-signature");
  const timestamp = req.header("x-railbridge-timestamp");
  const body = req.body;

  const ok = verifyWebhook({
    secret: process.env.RB_WEBHOOK_SECRET,
    timestamp,
    payload: body,
    signature
  });

  if (!ok) {
    return res.status(401).json({ error: "invalid signature" });
  }

  const event = JSON.parse(body);
  // Handle event.type
  return res.status(200).json({ ok: true });
});
```

## 5) Next.js route handler example

```js
import { verifyWebhook } from "@railbridgeai/merchant-sdk";

export async function POST(req) {
  const body = await req.text();
  const signature = req.headers.get("x-railbridge-signature");
  const timestamp = req.headers.get("x-railbridge-timestamp");

  const ok = verifyWebhook({
    secret: process.env.RB_WEBHOOK_SECRET,
    timestamp,
    payload: body,
    signature
  });

  if (!ok) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(body);
  // Handle event.type
  return Response.json({ ok: true });
}
```

## 6) Local development workflow

1. Run your backend locally.
2. Expose it with a public tunnel URL (for example ngrok).
3. Register that tunnel URL in RailBridge as webhook endpoint.
4. Click `Send test event` in Merchant OS Settings.
5. Confirm your backend logs receipt and returns HTTP `200`.

## 7) Local demo merchant webhook service (included in this repo)

If you want a quick in-repo receiver for testing, use:

```bash
cd merchant-os
npm run demo:webhook:service
```

By default this starts:

1. Webhook endpoint: `http://localhost:4070/webhooks/railbridge`
2. Health endpoint: `http://localhost:4070/health`
3. Event log endpoint: `http://localhost:4070/events`

### 7.1 End-to-end test flow

1. Start the receiver (temporarily without signature enforcement):

```bash
cd merchant-os
RB_WEBHOOK_REQUIRE_SIGNATURE=false npm run demo:webhook:service
```

2. In Merchant OS Settings, register webhook URL:
   `http://localhost:4070/webhooks/railbridge`

3. Click `Send test event`.

4. Confirm event reached receiver:

```bash
curl -s http://localhost:4070/events | jq
```

5. Copy the webhook signing secret shown when endpoint is created.

6. Restart receiver with signature verification enabled:

```bash
cd merchant-os
RB_WEBHOOK_SECRET=<your_whsec_value> RB_WEBHOOK_REQUIRE_SIGNATURE=true npm run demo:webhook:service
```

7. Click `Send test event` again and confirm `verified: true` in `/events`.

### 7.2 Useful receiver options

1. `RB_WEBHOOK_PORT` (default `4070`)
2. `RB_WEBHOOK_PATH` (default `/webhooks/railbridge`)
3. `RB_WEBHOOK_SECRET` (required for signature verification)
4. `RB_WEBHOOK_REQUIRE_SIGNATURE` (default `true`)
5. `RB_WEBHOOK_MAX_EVENTS` (default `200`)
6. `RB_WEBHOOK_MAX_BODY_BYTES` (default `1000000`)

## 8) Reliability recommendations

1. Acknowledge quickly with `200`; do long processing asynchronously.
2. Make your event handling idempotent using event id.
3. Persist webhook events for audit and replay handling.
4. Alert on repeated non-2xx responses.
5. Keep at least one active webhook endpoint in RailBridge settings.
