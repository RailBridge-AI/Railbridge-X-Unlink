import { createHmac, timingSafeEqual } from "node:crypto";

const normalizePayload = (payload) =>
  typeof payload === "string" ? payload : JSON.stringify(payload ?? {});

const normalizeSignature = (signature) => String(signature || "").trim().toLowerCase();

const secureHexEqual = (leftHex, rightHex) => {
  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
};

export const verifyWebhook = ({ secret, timestamp, payload, signature }) => {
  if (!secret || !timestamp || !signature) {
    return false;
  }

  const body = normalizePayload(payload);
  const signedPayload = `${String(timestamp)}.${body}`;
  const expected = createHmac("sha256", String(secret)).update(signedPayload).digest("hex");
  const actual = normalizeSignature(signature);

  if (!/^[a-f0-9]+$/.test(actual) || actual.length !== expected.length) {
    return false;
  }

  return secureHexEqual(expected, actual);
};

export const createExpressWebhookHandler = ({
  secret,
  requireSignature = true,
  onEvent,
} = {}) => {
  const handler = async (req, res) => {
    const signature = req.header("x-railbridge-signature");
    const timestamp = req.header("x-railbridge-timestamp");
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});

    if (requireSignature) {
      const ok = verifyWebhook({
        secret,
        timestamp,
        payload: rawBody,
        signature,
      });
      if (!ok) {
        return res.status(401).json({ error: "invalid signature" });
      }
    }

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return res.status(400).json({ error: "invalid JSON payload" });
    }

    if (typeof onEvent === "function") {
      await onEvent(event, {
        headers: req.headers,
        eventType: req.header("x-railbridge-event") || null,
        eventId: req.header("x-railbridge-event-id") || null,
      });
    }

    return res.status(200).json({ ok: true });
  };

  return handler;
};
