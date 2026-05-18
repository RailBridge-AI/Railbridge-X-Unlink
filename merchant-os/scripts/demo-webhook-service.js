import { createServer } from "node:http";
import { verifyWebhook } from "../sdk/index.js";

const parsePort = (value, fallback) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (Number.isNaN(parsed) || parsed <= 0 || parsed > 65535) {
    return fallback;
  }
  return parsed;
};

const normalizePath = (value, fallback) => {
  const text = String(value || "").trim();
  if (!text) {
    return fallback;
  }
  return text.startsWith("/") ? text : `/${text}`;
};

const getHeaderValue = (headers, name) => {
  const value = headers[name];
  if (Array.isArray(value)) {
    return value[0] || "";
  }
  return String(value || "").trim();
};

const readRawBody = async (req, maxBytes) => {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error(`payload too large (>${maxBytes} bytes)`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(payload, null, 2));
};

const port = parsePort(process.env.RB_WEBHOOK_PORT || process.env.PORT, 4070);
const webhookPath = normalizePath(process.env.RB_WEBHOOK_PATH, "/webhooks/railbridge");
const signingSecret = String(process.env.RB_WEBHOOK_SECRET || "").trim();
const requireSignature = process.env.RB_WEBHOOK_REQUIRE_SIGNATURE !== "false";
const maxStoredEvents = parsePort(process.env.RB_WEBHOOK_MAX_EVENTS, 200);
const maxBodyBytes = parsePort(process.env.RB_WEBHOOK_MAX_BODY_BYTES, 1_000_000);

const events = [];

const rememberEvent = (event) => {
  events.unshift(event);
  if (events.length > maxStoredEvents) {
    events.length = maxStoredEvents;
  }
};

const server = createServer(async (req, res) => {
  const method = String(req.method || "GET").toUpperCase();
  const host = req.headers.host || `localhost:${port}`;
  const requestUrl = new URL(req.url || "/", `http://${host}`);

  if (method === "GET" && requestUrl.pathname === "/health") {
    return sendJson(res, 200, {
      status: "ok",
      service: "railbridge-demo-merchant-webhook-service",
      timestamp: new Date().toISOString()
    });
  }

  if (method === "GET" && requestUrl.pathname === "/events") {
    return sendJson(res, 200, {
      count: events.length,
      items: events
    });
  }

  if (method === "DELETE" && requestUrl.pathname === "/events") {
    events.length = 0;
    return sendJson(res, 200, { ok: true, message: "event store cleared" });
  }

  if (method === "GET" && requestUrl.pathname === "/") {
    return sendJson(res, 200, {
      service: "RailBridge Demo Merchant Webhook Service",
      webhookPath,
      requireSignature,
      hasSigningSecret: Boolean(signingSecret),
      usage: {
        registerWebhookUrl: `http://localhost:${port}${webhookPath}`,
        health: `http://localhost:${port}/health`,
        events: `http://localhost:${port}/events`
      }
    });
  }

  if (method === "POST" && requestUrl.pathname === webhookPath) {
    let rawBody = "";
    try {
      rawBody = await readRawBody(req, maxBodyBytes);
    } catch (error) {
      return sendJson(res, 413, {
        error: error instanceof Error ? error.message : "failed to read request body"
      });
    }

    const signature = getHeaderValue(req.headers, "x-railbridge-signature");
    const timestamp = getHeaderValue(req.headers, "x-railbridge-timestamp");
    const eventType = getHeaderValue(req.headers, "x-railbridge-event");
    const eventId = getHeaderValue(req.headers, "x-railbridge-event-id");

    if (requireSignature && !signingSecret) {
      return sendJson(res, 500, {
        error: "RB_WEBHOOK_SECRET is required when RB_WEBHOOK_REQUIRE_SIGNATURE is true"
      });
    }

    const verified = signingSecret
      ? verifyWebhook({
        secret: signingSecret,
        timestamp,
        payload: rawBody,
        signature
      })
      : false;

    if (requireSignature && !verified) {
      rememberEvent({
        receivedAt: new Date().toISOString(),
        verified: false,
        eventType: eventType || "unknown",
        eventId: eventId || "unknown",
        error: "invalid signature",
        rawBody
      });
      return sendJson(res, 401, {
        error: "invalid signature",
        hint: "verify RB_WEBHOOK_SECRET and raw request body handling"
      });
    }

    let parsedBody = null;
    try {
      parsedBody = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      parsedBody = { rawBody };
    }

    const record = {
      receivedAt: new Date().toISOString(),
      verified: Boolean(verified),
      eventType: eventType || parsedBody?.type || "unknown",
      eventId: eventId || parsedBody?.id || "unknown",
      timestampHeader: timestamp || null,
      payload: parsedBody
    };
    rememberEvent(record);

    console.log(
      `[webhook-demo] event=${record.eventType} id=${record.eventId} verified=${record.verified ? "yes" : "no"}`
    );

    return sendJson(res, 200, {
      ok: true,
      received: {
        eventType: record.eventType,
        eventId: record.eventId,
        verified: record.verified
      }
    });
  }

  return sendJson(res, 404, { error: "Not found" });
});

server.listen(port, () => {
  console.log("[webhook-demo] Receiver running");
  console.log(`[webhook-demo] URL: http://localhost:${port}${webhookPath}`);
  console.log(`[webhook-demo] Health: http://localhost:${port}/health`);
  console.log(`[webhook-demo] Events: http://localhost:${port}/events`);
  if (!signingSecret) {
    console.warn("[webhook-demo] RB_WEBHOOK_SECRET is empty. Signature verification will fail when required.");
  }
});
