import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { verifyWebhook } from "../../sdk/index.js";
import {
  jsonRequest,
  startMerchantOsServer,
  startWebhookCaptureServer,
  waitFor
} from "../helpers/harness.js";

const MERCHANT_OS_CWD = fileURLToPath(new URL("../../", import.meta.url));

describe("Merchant OS core integration flows", () => {
  let server;
  let webhookReceiver;
  let token;
  let apiKey;
  let merchantId;
  let accountId;
  let webhookId;
  let webhookSecret;
  let productId;
  let userApiKeyId;

  const call = async (args) =>
    await jsonRequest({
      baseUrl: server.baseUrl,
      ...args
    });

  before(async () => {
    server = await startMerchantOsServer({ cwd: MERCHANT_OS_CWD });
    webhookReceiver = await startWebhookCaptureServer();
  });

  after(async () => {
    await webhookReceiver?.close();
    await server?.stop();
  });

  test("health endpoint is available", async () => {
    const response = await call({
      path: "/health"
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.status, "ok");
  });

  test("merchant onboarding returns credentials and checklist", async () => {
    const email = `merchant.${Date.now()}@example.com`;
    const response = await call({
      path: "/v1/onboarding/start",
      method: "POST",
      body: {
        merchantName: "Integration Test Merchant",
        adminEmail: email,
        adminPassword: "StrongPass123!",
        complianceProfile: { country: "US" }
      }
    });

    assert.equal(response.status, 201);
    assert.ok(response.body.token);
    assert.ok(response.body.apiKey);
    assert.ok(response.body.merchantId);
    assert.ok(response.body.accountId);
    assert.ok(Array.isArray(response.body.checklist.steps));

    token = response.body.token;
    apiKey = response.body.apiKey;
    merchantId = response.body.merchantId;
    accountId = response.body.accountId;

    const stepState = Object.fromEntries(
      response.body.checklist.steps.map((step) => [step.id, step.completed])
    );
    assert.equal(stepState.api_key, false);
    assert.equal(stepState.webhook, false);
    assert.equal(stepState.product, false);
    assert.equal(stepState.sandbox_payment, false);
    assert.equal(stepState.payout_test, false);
  });

  test("api key lifecycle works: create, edit, revoke", async () => {
    const createResponse = await call({
      path: "/v1/onboarding/api-keys",
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`
      },
      body: {
        name: "Integration Key",
        role: "finance"
      }
    });
    assert.equal(createResponse.status, 201);
    assert.ok(createResponse.body.id);
    assert.ok(createResponse.body.token);
    userApiKeyId = createResponse.body.id;

    const patchResponse = await call({
      path: `/v1/onboarding/api-keys/${userApiKeyId}`,
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`
      },
      body: {
        name: "Integration Key Renamed"
      }
    });
    assert.equal(patchResponse.status, 200);
    assert.equal(patchResponse.body.name, "Integration Key Renamed");
    assert.equal(patchResponse.body.status, "active");

    const revokeResponse = await call({
      path: `/v1/onboarding/api-keys/${userApiKeyId}/revoke`,
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    assert.equal(revokeResponse.status, 200);
    assert.equal(revokeResponse.body.status, "revoked");

    const keepActiveResponse = await call({
      path: "/v1/onboarding/api-keys",
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`
      },
      body: {
        name: "Primary Integration Key",
        role: "admin"
      }
    });
    assert.equal(keepActiveResponse.status, 201);
    assert.ok(keepActiveResponse.body.id);
    assert.ok(keepActiveResponse.body.token);
  });

  test("webhook lifecycle and signature verification work", async () => {
    const generatedSecret = `whsec_${randomUUID().replace(/-/g, "")}`;
    const createResponse = await call({
      path: "/v1/onboarding/webhooks",
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`
      },
      body: {
        url: webhookReceiver.webhookUrl,
        signingSecret: generatedSecret
      }
    });
    assert.equal(createResponse.status, 201);
    assert.ok(createResponse.body.id);
    webhookId = createResponse.body.id;
    webhookSecret = generatedSecret;

    const patchResponse = await call({
      path: `/v1/onboarding/webhooks/${webhookId}`,
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`
      },
      body: {
        url: webhookReceiver.webhookUrl,
        status: "active"
      }
    });
    assert.equal(patchResponse.status, 200);
    assert.equal(patchResponse.body.status, "active");

    const testResponse = await call({
      path: "/v1/onboarding/webhooks/test",
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    assert.equal(testResponse.status, 200);
    assert.equal(testResponse.body.sent, 1);

    const received = await waitFor(() => webhookReceiver.events[0], {
      timeoutMs: 5000,
      intervalMs: 50
    });

    assert.equal(received.headers["x-railbridge-event"], "webhook.test");
    assert.ok(received.headers["x-railbridge-signature"]);
    assert.ok(received.headers["x-railbridge-timestamp"]);

    const verified = verifyWebhook({
      secret: webhookSecret,
      timestamp: received.headers["x-railbridge-timestamp"],
      payload: received.body,
      signature: received.headers["x-railbridge-signature"]
    });
    assert.equal(verified, true);
  });

  test("checklist marks API key and webhook completed after setup", async () => {
    const response = await call({
      path: "/v1/onboarding/checklist",
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    assert.equal(response.status, 200);
    const stepState = Object.fromEntries(
      response.body.steps.map((step) => [step.id, step.completed])
    );
    assert.equal(stepState.api_key, true);
    assert.equal(stepState.webhook, true);
  });

  test("product APIs support create/list/update/delete with uniqueness checks", async () => {
    const createResponse = await call({
      path: `/v1/merchants/${merchantId}/products`,
      method: "POST",
      headers: {
        "x-railbridge-api-key": apiKey
      },
      body: {
        apiId: "integration_product",
        apiName: "Integration Product",
        method: "GET",
        path: "/api/integration",
        amountUsdc: "0.02"
      }
    });
    assert.equal(createResponse.status, 201);
    assert.equal(createResponse.body.sourceNetwork, "any");
    assert.equal(createResponse.body.settlementMode, "same_chain");
    productId = createResponse.body.id;

    const duplicateResponse = await call({
      path: `/v1/merchants/${merchantId}/products`,
      method: "POST",
      headers: {
        "x-railbridge-api-key": apiKey
      },
      body: {
        apiId: "integration_product",
        apiName: "Dup",
        method: "GET",
        path: "/api/integration-duplicate",
        amountUsdc: "0.02"
      }
    });
    assert.equal(duplicateResponse.status, 409);

    const listResponse = await call({
      path: `/v1/merchants/${merchantId}/products`,
      headers: {
        "x-railbridge-api-key": apiKey
      }
    });
    assert.equal(listResponse.status, 200);
    assert.equal(listResponse.body.items.length, 1);

    const updateResponse = await call({
      path: `/v1/merchants/${merchantId}/products/${productId}`,
      method: "PUT",
      headers: {
        "x-railbridge-api-key": apiKey
      },
      body: {
        apiName: "Integration Product Updated",
        settlementMode: "same_chain",
        destinationNetwork: "eip155:11155111"
      }
    });
    assert.equal(updateResponse.status, 200);
    assert.equal(updateResponse.body.apiName, "Integration Product Updated");
    assert.equal(updateResponse.body.settlementMode, "same_chain");
    assert.equal(updateResponse.body.destinationNetwork, null);
  });

  test("requirements resolvers support sdk api-key flow and internal token flow", async () => {
    const sdkUnauthorized = await call({
      path: "/v1/sdk/requirements/resolve",
      method: "POST",
      body: {
        method: "GET",
        path: "/api/integration"
      }
    });
    assert.equal(sdkUnauthorized.status, 401);

    const sdkAuthorized = await call({
      path: "/v1/sdk/requirements/resolve",
      method: "POST",
      headers: {
        "x-railbridge-api-key": apiKey
      },
      body: {
        apiId: "integration_product"
      }
    });
    assert.equal(sdkAuthorized.status, 200);
    assert.equal(sdkAuthorized.body.settlementMode, "same_chain");
    assert.ok(Array.isArray(sdkAuthorized.body.requirements));
    assert.ok(sdkAuthorized.body.requirements.length >= 1);
    assert.equal(sdkAuthorized.body.apiProduct.apiId, "integration_product");
    assert.equal(sdkAuthorized.body.crossChain, null);

    const unauthorized = await call({
      path: "/v1/internal/requirements/resolve",
      method: "POST",
      body: {
        merchantId,
        accountId,
        method: "GET",
        path: "/api/integration"
      }
    });
    assert.equal(unauthorized.status, 401);

    const authorized = await call({
      path: "/v1/internal/requirements/resolve",
      method: "POST",
      headers: {
        "x-merchant-os-internal-token": "test-internal-token"
      },
      body: {
        merchantId,
        accountId,
        method: "GET",
        path: "/api/integration"
      }
    });
    assert.equal(authorized.status, 200);
    assert.equal(authorized.body.settlementMode, "same_chain");
    assert.ok(Array.isArray(authorized.body.requirements));
    assert.ok(authorized.body.requirements.length >= 1);
    assert.equal(authorized.body.crossChain, null);
  });

  test("settlement ingest validates auth, supports idempotency, and updates balances", async () => {
    const unauthorized = await call({
      path: "/v1/internal/events/settlements",
      method: "POST",
      body: {
        merchantId,
        accountId,
        sourceNetwork: "eip155:421614",
        asset: "USDC",
        amount: "10000",
        status: "settled_source",
        txHash: "0xsettleunauthorized"
      }
    });
    assert.equal(unauthorized.status, 401);

    const invalid = await call({
      path: "/v1/internal/events/settlements",
      method: "POST",
      headers: {
        "x-merchant-os-ingest-token": "test-ingest-token"
      },
      body: {
        merchantId,
        accountId,
        sourceNetwork: "eip155:421614",
        asset: "USDC",
        amount: "10000",
        status: "unknown_status",
        txHash: "0xsettleinvalid"
      }
    });
    assert.equal(invalid.status, 400);

    const eventId = `evt_${Date.now()}`;
    const ingest = await call({
      path: "/v1/internal/events/settlements",
      method: "POST",
      headers: {
        "x-merchant-os-ingest-token": "test-ingest-token"
      },
      body: {
        eventId,
        settlementId: `stl_${Date.now()}`,
        merchantId,
        accountId,
        sourceNetwork: "eip155:421614",
        destinationNetwork: null,
        asset: "USDC",
        amount: "30000",
        status: "settled_source",
        txHash: "0xabc123"
      }
    });
    assert.equal(ingest.status, 200);
    assert.equal(ingest.body.duplicate, false);

    const duplicate = await call({
      path: "/v1/internal/events/settlements",
      method: "POST",
      headers: {
        "x-merchant-os-ingest-token": "test-ingest-token"
      },
      body: {
        eventId,
        settlementId: `stl_${Date.now()}`,
        merchantId,
        accountId,
        sourceNetwork: "eip155:421614",
        destinationNetwork: null,
        asset: "USDC",
        amount: "30000",
        status: "settled_source",
        txHash: "0xabc123"
      }
    });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.duplicate, true);

    const balances = await call({
      path: `/v1/merchants/${merchantId}/balances`,
      headers: {
        "x-railbridge-api-key": apiKey
      }
    });
    assert.equal(balances.status, 200);
    assert.equal(balances.body.merchantId, merchantId);
    assert.ok(Array.isArray(balances.body.balances));
    assert.equal(typeof balances.body.availableUsd, "string");
  });

  test("consolidation and payout flows work in simulation mode", async () => {
    const insufficientBridge = await call({
      path: `/v1/merchants/${merchantId}/consolidations`,
      method: "POST",
      headers: {
        "x-railbridge-api-key": apiKey
      },
      body: {
        sourceNetwork: "eip155:421614",
        destinationNetwork: "eip155:11155111",
        amountUsdc: "999999.00"
      }
    });
    assert.equal(insufficientBridge.status, 400);
    assert.equal(insufficientBridge.body.error, "insufficient source balance");

    const estimate = await call({
      path: `/v1/merchants/${merchantId}/consolidations/estimate`,
      method: "POST",
      headers: {
        "x-railbridge-api-key": apiKey
      },
      body: {
        sourceNetwork: "eip155:421614",
        destinationNetwork: "eip155:11155111",
        amountUsdc: "0.01"
      }
    });
    assert.equal(estimate.status, 200);
    assert.equal(estimate.body.executionMode, "simulation");
    assert.equal(estimate.body.amountUsdc, "0.01");
    assert.ok(Array.isArray(estimate.body.gasFees));
    assert.ok(estimate.body.recommendation);

    const bridge = await call({
      path: `/v1/merchants/${merchantId}/consolidations`,
      method: "POST",
      headers: {
        "x-railbridge-api-key": apiKey
      },
      body: {
        sourceNetwork: "eip155:421614",
        destinationNetwork: "eip155:11155111",
        amountUsdc: "0.01"
      }
    });
    assert.equal(bridge.status, 202);
    assert.equal(bridge.body.status, "confirmed");
    assert.ok(bridge.body.id);
    assert.ok(bridge.body.statusPath);

    const consolidationStatus = await call({
      path: bridge.body.statusPath,
      headers: {
        "x-railbridge-api-key": apiKey
      }
    });
    assert.equal(consolidationStatus.status, 200);
    assert.equal(consolidationStatus.body.id, bridge.body.id);
    assert.equal(consolidationStatus.body.status, "confirmed");

    const invalidPayout = await call({
      path: `/v1/merchants/${merchantId}/payouts`,
      method: "POST",
      headers: {
        "x-railbridge-api-key": apiKey
      },
      body: {
        network: "eip155:421614",
        amountUsdc: "0.005",
        destinationAddress: "not-an-address"
      }
    });
    assert.equal(invalidPayout.status, 400);

    const payout = await call({
      path: `/v1/merchants/${merchantId}/payouts`,
      method: "POST",
      headers: {
        "x-railbridge-api-key": apiKey
      },
      body: {
        network: "eip155:421614",
        amountUsdc: "0.005",
        destinationAddress: "0x1234567890123456789012345678901234567890"
      }
    });
    assert.equal(payout.status, 201);
    assert.equal(payout.body.status, "completed");
  });

  test("settings and checklist reflect completed core setup", async () => {
    const settings = await call({
      path: `/v1/merchants/${merchantId}/settings`,
      headers: {
        "x-railbridge-api-key": apiKey
      }
    });
    assert.equal(settings.status, 200);
    assert.ok(Array.isArray(settings.body.apiKeys));
    assert.ok(Array.isArray(settings.body.webhooks));
    assert.ok(Array.isArray(settings.body.chains));
    assert.ok(Array.isArray(settings.body.checklist.steps));

    const checklistState = Object.fromEntries(
      settings.body.checklist.steps.map((step) => [step.id, step.completed])
    );
    assert.equal(checklistState.api_key, true);
    assert.equal(checklistState.webhook, true);
    assert.equal(checklistState.product, true);
    assert.equal(checklistState.sandbox_payment, true);
    assert.equal(checklistState.payout_test, true);
  });

  test("product delete removes route cleanly", async () => {
    const deleteResponse = await call({
      path: `/v1/merchants/${merchantId}/products/${productId}`,
      method: "DELETE",
      headers: {
        "x-railbridge-api-key": apiKey
      }
    });
    assert.equal(deleteResponse.status, 200);
    assert.equal(deleteResponse.body.success, true);

    const listResponse = await call({
      path: `/v1/merchants/${merchantId}/products`,
      headers: {
        "x-railbridge-api-key": apiKey
      }
    });
    assert.equal(listResponse.status, 200);
    assert.equal(listResponse.body.items.length, 0);
  });
});
