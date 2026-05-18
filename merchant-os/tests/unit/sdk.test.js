import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, describe, test } from "node:test";
import {
  getOnboardingStatus,
  protectRoute,
  resolveRequirements,
  verifyWebhook
} from "../../sdk/index.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Merchant OS SDK", () => {
  test("protectRoute builds normalized route payload", () => {
    const spec = protectRoute({
      method: "post",
      path: " /api/premium ",
      priceUsdc: " 0.25 ",
      settlementPolicyId: "sp_default",
      metadata: { tier: "pro" }
    });

    assert.deepEqual(spec, {
      route: {
        method: "POST",
        path: "/api/premium"
      },
      pricing: {
        asset: "USDC",
        amountUsdc: "0.25"
      },
      settlementPolicyId: "sp_default",
      metadata: { tier: "pro" }
    });
  });

  test("protectRoute enforces required path and price", () => {
    assert.throws(() => protectRoute({ path: "", priceUsdc: "1" }), /path is required/);
    assert.throws(() => protectRoute({ path: "/a" }), /priceUsdc is required/);
  });

  test("verifyWebhook validates HMAC signature", () => {
    const secret = "whsec_test_123";
    const timestamp = "1710000000";
    const payload = JSON.stringify({ type: "payment.settled_source", id: "evt_1" });

    const validSignature = createHmac("sha256", secret)
      .update(`${timestamp}.${payload}`)
      .digest("hex");

    assert.equal(
      verifyWebhook({
        secret,
        timestamp,
        payload,
        signature: validSignature
      }),
      true
    );

    assert.equal(
      verifyWebhook({
        secret,
        timestamp,
        payload,
        signature: "invalid"
      }),
      false
    );
  });

  test("resolveRequirements validates inputs before request", async () => {
    await assert.rejects(
      resolveRequirements({
        merchantOsUrl: "",
        apiKey: "",
        method: "GET",
        path: "/api/premium"
      }),
      /merchantOsUrl and apiKey are required/
    );
  });

  test("resolveRequirements sends signed request and returns payload", async () => {
    let capturedUrl;
    let capturedOptions;
    globalThis.fetch = async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({ requirements: [{ network: "eip155:421614" }] })
      };
    };

    const payload = await resolveRequirements({
      merchantOsUrl: "http://localhost:3055/",
      apiKey: "rb_live_test",
      apiId: "premium_api",
      method: "get",
      path: "/api/premium"
    });

    assert.equal(capturedUrl, "http://localhost:3055/v1/sdk/requirements/resolve");
    assert.equal(capturedOptions.method, "POST");
    assert.equal(capturedOptions.headers["x-railbridge-api-key"], "rb_live_test");

    const body = JSON.parse(capturedOptions.body);
    assert.equal(body.apiId, "premium_api");
    assert.equal(body.method, "GET");
    assert.equal(body.path, "/api/premium");
    assert.deepEqual(payload, { requirements: [{ network: "eip155:421614" }] });
  });

  test("resolveRequirements throws useful error on non-2xx", async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: "forbidden" })
    });

    await assert.rejects(
      resolveRequirements({
        merchantOsUrl: "http://localhost:3055",
        apiKey: "rb_live_test",
        method: "GET",
        path: "/api/premium"
      }),
      /forbidden/
    );
  });

  test("getOnboardingStatus validates inputs", async () => {
    await assert.rejects(
      getOnboardingStatus({ merchantOsUrl: "", token: "" }),
      /merchantOsUrl and token are required/
    );
  });

  test("getOnboardingStatus sends auth header and returns checklist", async () => {
    let capturedUrl;
    let capturedOptions;

    globalThis.fetch = async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({ steps: [{ id: "api_key", completed: true }] })
      };
    };

    const payload = await getOnboardingStatus({
      merchantOsUrl: "http://localhost:3055",
      token: "bearer_token"
    });

    assert.equal(capturedUrl, "http://localhost:3055/v1/onboarding/checklist");
    assert.equal(capturedOptions.method, "GET");
    assert.equal(capturedOptions.headers.authorization, "Bearer bearer_token");
    assert.deepEqual(payload, { steps: [{ id: "api_key", completed: true }] });
  });
});
