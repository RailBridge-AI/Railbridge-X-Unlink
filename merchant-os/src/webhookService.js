import { createHmac, timingSafeEqual } from "node:crypto";
import { nowIso } from "./utils.js";
import {
  insertWebhookDelivery,
  listActiveWebhookEndpoints,
  markWebhookTestResult
} from "./db.js";

const signPayload = (secret, payload) =>
  createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

export const verifyWebhookSignature = ({ secret, timestamp, payload, signature }) => {
  const signedPayload = `${timestamp}.${payload}`;
  const expected = signPayload(secret, signedPayload);
  const actual = String(signature || "").trim();
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(actual, "utf8");
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, actualBuffer);
};

const postWebhook = async ({ endpoint, eventType, eventId, payload }) => {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signPayload(endpoint.signingSecret, `${timestamp}.${body}`);
  const headers = {
    "content-type": "application/json",
    "x-railbridge-event": eventType,
    "x-railbridge-event-id": eventId,
    "x-railbridge-timestamp": timestamp,
    "x-railbridge-signature": signature
  };

  try {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers,
      body
    });
    const responseText = await response.text().catch(() => "");
    insertWebhookDelivery({
      webhookId: endpoint.id,
      merchantId: endpoint.merchantId,
      accountId: endpoint.accountId,
      eventType,
      eventId,
      requestBody: body,
      responseStatus: response.status,
      responseBody: responseText.slice(0, 2000),
      error: response.ok ? null : `HTTP ${response.status}`
    });
    return response.ok;
  } catch (error) {
    insertWebhookDelivery({
      webhookId: endpoint.id,
      merchantId: endpoint.merchantId,
      accountId: endpoint.accountId,
      eventType,
      eventId,
      requestBody: body,
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
};

export const publishTenantWebhookEvent = async ({
  merchantId,
  accountId,
  eventType,
  eventId,
  data
}) => {
  const endpoints = listActiveWebhookEndpoints(merchantId, accountId);
  if (!endpoints.length) {
    return {
      sent: 0,
      acknowledged: 0
    };
  }

  const payload = {
    id: eventId,
    type: eventType,
    createdAt: nowIso(),
    data
  };

  const results = await Promise.all(
    endpoints.map((endpoint) => postWebhook({ endpoint, eventType, eventId, payload }))
  );

  return {
    sent: endpoints.length,
    acknowledged: results.filter(Boolean).length
  };
};

export const sendWebhookTestEvent = async ({ merchantId, accountId }) => {
  const eventId = `evt_test_${Date.now()}`;
  const endpoints = listActiveWebhookEndpoints(merchantId, accountId);

  const results = await Promise.all(
    endpoints.map(async (endpoint) => {
      const ok = await postWebhook({
        endpoint,
        eventType: "webhook.test",
        eventId,
        payload: {
          id: eventId,
          type: "webhook.test",
          createdAt: nowIso(),
          data: {
            message: "RailBridge webhook test event"
          }
        }
      });
      markWebhookTestResult(
        endpoint.merchantId,
        endpoint.accountId,
        endpoint.id,
        ok ? "ok" : "failed"
      );
      return ok;
    })
  );

  return {
    eventId,
    sent: endpoints.length,
    acknowledged: results.filter(Boolean).length
  };
};
