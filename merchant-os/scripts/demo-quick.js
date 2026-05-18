import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { config } from "../src/config.js";
import { resetDatabase } from "../src/db.js";

const baseUrl = `http://localhost:${config.port}`;

const waitForHealth = async (serverState) => {
  for (let i = 0; i < 30; i += 1) {
    if (serverState.exited) {
      throw new Error(
        `Merchant OS server exited before health check (code=${serverState.code ?? "unknown"}, signal=${serverState.signal ?? "none"})`
      );
    }
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) {
        return;
      }
    } catch {
      // ignore until timeout
    }
    await sleep(300);
  }
  throw new Error("Merchant OS server did not become healthy in time");
};

const runFlow = async () => {
  const loginRes = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "ops+alpha@railbridge.demo",
      password: "demo123",
    }),
  });
  const login = await loginRes.json();
  if (!loginRes.ok) {
    throw new Error(`Login failed: ${JSON.stringify(login)}`);
  }
  if (!login.apiKey) {
    throw new Error("Login response missing apiKey");
  }

  const merchantId = login.merchantId;
  const accountId = login.accountId;
  const merchantHeaders = {
    "content-type": "application/json",
    "x-railbridge-api-key": login.apiKey,
  };

  const ingest = async (payload) => {
    const res = await fetch(`${baseUrl}/v1/internal/events/settlements`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-merchant-os-ingest-token": config.ingestToken,
      },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(`Ingest failed: ${JSON.stringify(body)}`);
    }
  };

  await ingest({
    eventId: "demo-evt-1",
    settlementId: "demo-settlement-1",
    merchantId,
    accountId,
    apiId: "GET /api/premium",
    apiRoute: "GET /api/premium",
    apiName: "Premium API",
    sourceNetwork: "eip155:84532",
    destinationNetwork: null,
    asset: "USDC",
    amount: "1500000",
    status: "settled_source",
    txHash: "0xset0001",
  });

  await ingest({
    eventId: "demo-evt-2",
    settlementId: "demo-settlement-2",
    merchantId,
    accountId,
    apiId: "GET /api/premium",
    apiRoute: "GET /api/premium",
    apiName: "Premium API",
    sourceNetwork: "eip155:11155111",
    destinationNetwork: null,
    asset: "USDC",
    amount: "2000000",
    status: "settled_source",
    txHash: "0xset0002",
  });

  await ingest({
    eventId: "demo-evt-3",
    settlementId: "demo-settlement-3",
    merchantId,
    accountId,
    apiId: "GET /api/premium",
    apiRoute: "GET /api/premium",
    apiName: "Premium API",
    sourceNetwork: "eip155:84532",
    destinationNetwork: "eip155:11155111",
    asset: "USDC",
    amount: "1000000",
    status: "bridge_pending",
    txHash: "0xset0003",
  });

  await ingest({
    eventId: "demo-evt-4",
    settlementId: "demo-settlement-3",
    merchantId,
    accountId,
    apiId: "GET /api/premium",
    apiRoute: "GET /api/premium",
    apiName: "Premium API",
    sourceNetwork: "eip155:84532",
    destinationNetwork: "eip155:11155111",
    asset: "USDC",
    amount: "1000000",
    status: "bridge_confirmed",
    txHash: "0xmint0003",
  });

  const consolidationRes = await fetch(
    `${baseUrl}/v1/merchants/${merchantId}/consolidations`,
    {
      method: "POST",
      headers: merchantHeaders,
      body: JSON.stringify({
        sourceNetwork: "eip155:84532",
        destinationNetwork: "eip155:11155111",
        asset: "USDC",
        amount: "500000",
      }),
    },
  );
  const consolidation = await consolidationRes.json();
  if (!consolidationRes.ok) {
    throw new Error(`Consolidation failed: ${JSON.stringify(consolidation)}`);
  }

  const overviewRes = await fetch(`${baseUrl}/v1/merchants/${merchantId}/balances`, {
    headers: { "x-railbridge-api-key": login.apiKey },
  });
  const overview = await overviewRes.json();
  if (!overviewRes.ok) {
    throw new Error(`Overview failed: ${JSON.stringify(overview)}`);
  }

  const settlementsRes = await fetch(`${baseUrl}/v1/merchants/${merchantId}/settlements`, {
    headers: { "x-railbridge-api-key": login.apiKey },
  });
  const settlements = await settlementsRes.json();
  if (!settlementsRes.ok) {
    throw new Error(`Settlements failed: ${JSON.stringify(settlements)}`);
  }

  console.log("Demo flow complete.");
  console.log(`Merchant: ${merchantId}`);
  console.log(`Account: ${accountId}`);
  console.log(`Unified USD: ${overview.availableUsd}`);
  console.log(`Balances: ${overview.balances.map((b) => `${b.network}:${b.usdValue}`).join(", ")}`);
  console.log(`Timeline items: ${settlements.items.length}`);
  console.log(`Consolidation status: ${consolidation.status}`);
  console.log(`Open dashboard: ${baseUrl}/`);
};

const main = async () => {
  resetDatabase();
  const server = spawn(process.execPath, ["src/server.js"], {
    stdio: "inherit",
    cwd: process.cwd(),
  });
  const serverState = {
    exited: false,
    code: null,
    signal: null,
  };
  server.on("exit", (code, signal) => {
    serverState.exited = true;
    serverState.code = code;
    serverState.signal = signal;
  });

  try {
    await waitForHealth(serverState);
    if (serverState.exited) {
      throw new Error(
        `Merchant OS server exited before demo flow (code=${serverState.code ?? "unknown"}, signal=${serverState.signal ?? "none"})`
      );
    }
    await runFlow();
  } finally {
    server.kill("SIGTERM");
    await sleep(300);
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
