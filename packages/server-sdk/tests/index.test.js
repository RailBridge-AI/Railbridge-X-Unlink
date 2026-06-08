import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, describe, test } from "node:test";
import {
  createRailbridge,
  createRailbridgeFromEnv,
  getOnboardingStatus,
  verifyWebhook,
} from "../src/index.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("@railbridgeai/merchant-sdk", () => {
  test("createRailbridge applies testnet defaults synchronously", () => {
    const client = createRailbridge({
      apiKey: "rb_test_key",
      environment: "testnet",
    });

    assert.equal(client.environment, "testnet");
    assert.equal(client.merchantOsUrl, "https://api.testnet.railbridge.ai");
    assert.equal(client.facilitatorUrl, "https://facilitator.testnet.railbridge.ai");
  });

  test("createRailbridgeFromEnv reads env variables and advanced overrides", () => {
    const client = createRailbridgeFromEnv({
      RB_API_KEY: "rb_env_key",
      RB_ENV: "testnet",
      RB_MERCHANT_OS_URL: "https://merchant.example.com",
      RB_FACILITATOR_URL: "https://facilitator.example.com",
      RB_PAYWALL_TESTNET: "true",
      RB_MAX_REQUIREMENT_OPTIONS: "12",
      RB_AUTO_REFRESH_MS: "45000",
      RB_SOURCE_NETWORK_FILTER: "testnet_only",
      RB_LOG_PREFIX: "[merchant-sdk]",
      RB_PAYWALL_APP_NAME: "Merchant Backend",
    });

    assert.equal(client.environment, "testnet");
    assert.equal(client.merchantOsUrl, "https://merchant.example.com");
    assert.equal(client.facilitatorUrl, "https://facilitator.example.com");
  });

  test("createRailbridgeFromEnv requires RB_ENV or explicit environment override", () => {
    assert.throws(
      () =>
        createRailbridgeFromEnv({
          RB_API_KEY: "rb_env_key",
        }),
      /RB_ENV or RAILBRIDGE_ENV is required/,
    );
  });

  test("createRailbridgeFromEnv validates boolean env values", () => {
    assert.throws(
      () =>
        createRailbridgeFromEnv({
          RB_API_KEY: "rb_env_key",
          RB_ENV: "testnet",
          RB_PAYWALL_TESTNET: "maybe",
        }),
      /RB_PAYWALL_TESTNET must be a boolean-like value/,
    );
  });

  test("createRailbridge supports advanced hosted-url overrides", () => {
    const client = createRailbridge({
      apiKey: "rb_env_key",
      environment: "testnet",
      advanced: {
        merchantOsUrl: "https://merchant.example.com",
        facilitatorUrl: "https://facilitator.example.com",
      },
    });

    assert.equal(client.merchantOsUrl, "https://merchant.example.com");
    assert.equal(client.facilitatorUrl, "https://facilitator.example.com");
  });

  test("resolveRequirements sends signed request payload", async () => {
    let capturedRequest;
    globalThis.fetch = async (url, options) => {
      capturedRequest = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({ requirement: { network: "eip155:84532" } }),
      };
    };

    const client = createRailbridge({
      apiKey: "rb_live_test",
      environment: "testnet",
      advanced: {
        merchantOsUrl: "https://merchant-os.example.com/",
      },
    });

    const response = await client.resolveRequirements({
      apiId: "premium_api",
      method: "post",
      path: "/api/premium",
    });

    assert.equal(
      capturedRequest.url,
      "https://merchant-os.example.com/v1/sdk/requirements/resolve",
    );
    assert.equal(capturedRequest.options.method, "POST");
    assert.equal(capturedRequest.options.headers["x-railbridge-api-key"], "rb_live_test");
    assert.equal(JSON.parse(capturedRequest.options.body).method, "POST");
    assert.deepEqual(response, { requirement: { network: "eip155:84532" } });
  });

  test("getOnboardingStatus helper uses bearer token", async () => {
    let capturedRequest;
    globalThis.fetch = async (url, options) => {
      capturedRequest = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({ steps: [{ id: "api_key", completed: true }] }),
      };
    };

    const payload = await getOnboardingStatus({
      merchantOsUrl: "https://merchant-os.example.com",
      token: "test_token",
    });

    assert.equal(capturedRequest.url, "https://merchant-os.example.com/v1/onboarding/checklist");
    assert.equal(capturedRequest.options.method, "GET");
    assert.equal(capturedRequest.options.headers.authorization, "Bearer test_token");
    assert.deepEqual(payload, { steps: [{ id: "api_key", completed: true }] });
  });

  test("verifyWebhook validates HMAC signature", () => {
    const secret = "whsec_test_123";
    const timestamp = "1710000000";
    const payload = JSON.stringify({ type: "payment.settled_source", id: "evt_1" });
    const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");

    assert.equal(
      verifyWebhook({
        secret,
        timestamp,
        payload,
        signature,
      }),
      true,
    );
    assert.equal(
      verifyWebhook({
        secret,
        timestamp,
        payload,
        signature: "invalid",
      }),
      false,
    );
  });

  test("protectExpress mounts middleware and handler on the app route", async () => {
    const calls = [];
    const app = Object.assign(() => {}, {
      get(path, ...handlers) {
        calls.push({ method: "get", path, handlers });
      },
    });

    const client = createRailbridge({
      apiKey: "rb_test_key",
      environment: "testnet",
    });

    const fakeMiddleware = Object.assign(
      (_req, _res, next) => next?.(),
      {
        routeMethod: "GET",
        routePath: "/api/premium",
      },
    );

    client.protect = async () => fakeMiddleware;

    const handler = (_req, res) => res.json({ ok: true });
    const mounted = await client.protectExpress(
      app,
      {
        apiId: "premium_api",
        method: "GET",
        path: "/api/premium",
      },
      handler,
    );

    assert.equal(mounted, fakeMiddleware);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "get");
    assert.equal(calls[0].path, "/api/premium");
    assert.equal(calls[0].handlers[0], fakeMiddleware);
    assert.equal(calls[0].handlers[1], handler);
  });
});
