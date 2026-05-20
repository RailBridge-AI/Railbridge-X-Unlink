import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const waitFor = async (predicate, { timeoutMs = 5000, intervalMs = 50 } = {}) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await predicate();
    if (value) {
      return value;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
};

export const getFreePort = async () =>
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve(port);
        }
      });
    });
  });

export const jsonRequest = async ({
  baseUrl,
  path,
  method = "GET",
  headers = {},
  body
}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  return {
    status: response.status,
    ok: response.ok,
    body: payload
  };
};

export const startWebhookCaptureServer = async () => {
  const port = await getFreePort();
  const events = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString("utf8");

    if (req.method === "POST" && req.url === "/webhooks/railbridge") {
      const headers = {};
      Object.entries(req.headers).forEach(([key, value]) => {
        headers[key] = Array.isArray(value) ? value.join(",") : String(value || "");
      });
      events.push({
        receivedAt: new Date().toISOString(),
        method: req.method,
        path: req.url,
        headers,
        body
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    webhookUrl: `http://127.0.0.1:${port}/webhooks/railbridge`,
    events,
    close: async () =>
      await new Promise((resolve) => {
        server.close(() => resolve());
      })
  };
};

export const startMerchantOsServer = async ({ cwd }) => {
  const port = await getFreePort();
  const tempRoot = mkdtempSync(join(tmpdir(), "merchant-os-tests-"));
  const dbPath = join(tempRoot, "merchant-os.db");

  const env = {
    ...process.env,
    MERCHANT_OS_PORT: String(port),
    MERCHANT_OS_DB_PATH: dbPath,
    MERCHANT_OS_WEB_URL: "http://localhost:3000",
    MERCHANT_OS_INGEST_TOKEN: "test-ingest-token",
    MERCHANT_OS_INTERNAL_TOKEN: "test-internal-token",
    MERCHANT_OS_ADMIN_TOKEN: "test-admin-token",
    MERCHANT_OS_CUSTODY_MASTER_KEY:
      "0x1111111111111111111111111111111111111111111111111111111111111111",
    MERCHANT_OS_ONBOARDING_AUTO_APPROVE: "true",
    MERCHANT_OS_REAL_CONSOLIDATION_BRIDGE: "false",
    MERCHANT_OS_REAL_PAYOUTS_ENABLED: "false",
    MERCHANT_OS_FACILITATOR_ADDRESS: "0x1111111111111111111111111111111111111111",
    MERCHANT_OS_ONCHAIN_TIMEOUT_MS: "20",
    MERCHANT_OS_ONCHAIN_TOTAL_BUDGET_MS: "20",
    MERCHANT_OS_CHAIN_SYNC_MS: "300000"
  };

  const child = spawn(process.execPath, ["src/server.js"], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const logs = [];
  const onOutput = (chunk) => {
    const text = String(chunk || "").trim();
    if (text) {
      logs.push(text);
    }
  };
  child.stdout.on("data", onOutput);
  child.stderr.on("data", onOutput);

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitFor(async () => {
    if (child.exitCode !== null) {
      throw new Error(`Merchant OS server exited early with code ${child.exitCode}\n${logs.join("\n")}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }, { timeoutMs: 20000, intervalMs: 150 });

  return {
    port,
    baseUrl,
    dbPath,
    tempRoot,
    logs,
    stop: async () => {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await waitFor(() => child.exitCode !== null, { timeoutMs: 5000, intervalMs: 50 }).catch(() => {
          child.kill("SIGKILL");
        });
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  };
};
