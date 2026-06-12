import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { afterEach, describe, test } from "node:test";
import { jsonRequest, startMerchantOsServer } from "../helpers/harness.js";

const MERCHANT_OS_CWD = fileURLToPath(new URL("../../", import.meta.url));

describe("Merchant OS onboarding allowlist behavior", () => {
  let server;

  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  test("allows signup when allowlist is empty and auto-approve is disabled", async () => {
    server = await startMerchantOsServer({
      cwd: MERCHANT_OS_CWD,
      runtimeConfigOverrides: {
        onboardingAutoApprove: false,
        onboardingAllowlistDomains: []
      }
    });

    const response = await jsonRequest({
      baseUrl: server.baseUrl,
      path: "/v1/onboarding/start",
      method: "POST",
      body: {
        merchantName: "Open Signup Merchant",
        adminEmail: `open.${Date.now()}@anydomain.com`,
        adminPassword: "StrongPass123!"
      }
    });

    assert.equal(response.status, 201);
    assert.ok(response.body.token);
    assert.ok(response.body.apiKey);
  });

  test("rejects signup when allowlist is configured and the email domain does not match", async () => {
    server = await startMerchantOsServer({
      cwd: MERCHANT_OS_CWD,
      runtimeConfigOverrides: {
        onboardingAutoApprove: false,
        onboardingAllowlistDomains: ["allowed.com"]
      }
    });

    const response = await jsonRequest({
      baseUrl: server.baseUrl,
      path: "/v1/onboarding/start",
      method: "POST",
      body: {
        merchantName: "Restricted Signup Merchant",
        adminEmail: `blocked.${Date.now()}@other.com`,
        adminPassword: "StrongPass123!"
      }
    });

    assert.equal(response.status, 403);
    assert.equal(response.body.error, "domain_not_allowlisted");
  });
});
