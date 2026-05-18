import { createHmac } from "node:crypto";

const normalizeMethod = (method) => String(method || "GET").trim().toUpperCase();

export const protectRoute = ({
  method = "GET",
  path,
  priceUsdc,
  settlementPolicyId = null,
  metadata = {}
}) => {
  if (!path || !String(path).trim()) {
    throw new Error("path is required");
  }
  if (priceUsdc === undefined || priceUsdc === null || String(priceUsdc).trim() === "") {
    throw new Error("priceUsdc is required");
  }

  return {
    route: {
      method: normalizeMethod(method),
      path: String(path).trim()
    },
    pricing: {
      asset: "USDC",
      amountUsdc: String(priceUsdc).trim()
    },
    settlementPolicyId,
    metadata
  };
};

export const resolveRequirements = async ({
  merchantOsUrl,
  apiKey,
  apiId,
  apiProductId,
  method,
  path,
  settlementModeOverride
}) => {
  if (!merchantOsUrl || !apiKey) {
    throw new Error("merchantOsUrl and apiKey are required");
  }

  const response = await fetch(`${merchantOsUrl.replace(/\/$/, "")}/v1/sdk/requirements/resolve`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-railbridge-api-key": apiKey
    },
    body: JSON.stringify({
      apiId,
      apiProductId,
      method: normalizeMethod(method),
      path,
      settlementModeOverride
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Requirement resolution failed (${response.status})`);
  }
  return payload;
};

export const verifyWebhook = ({ secret, timestamp, payload, signature }) => {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const signedPayload = `${timestamp}.${body}`;
  const expected = createHmac("sha256", secret).update(signedPayload).digest("hex");
  return expected === String(signature || "").trim();
};

export const getOnboardingStatus = async ({ merchantOsUrl, token }) => {
  if (!merchantOsUrl || !token) {
    throw new Error("merchantOsUrl and token are required");
  }

  const response = await fetch(`${merchantOsUrl.replace(/\/$/, "")}/v1/onboarding/checklist`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${token}`
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Checklist fetch failed (${response.status})`);
  }
  return payload;
};
