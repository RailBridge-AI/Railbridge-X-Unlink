import { copyFile, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..", "..");
const exampleDir = join(repoRoot, "examples", "merchant-sdk-minimal");
const envExamplePath = join(exampleDir, ".env.example");
const envPath = join(exampleDir, ".env");
const envLocalPath = join(exampleDir, ".env.local");
const merchantUrl = "http://localhost:4025";
const merchantOsUrl = "http://localhost:4030";
const facilitatorUrl = "http://localhost:4022";

const run = (command, args, { cwd = repoRoot, env = process.env } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
    child.on("error", reject);
  });

const start = (command, args, { cwd = repoRoot, env = process.env } = {}) =>
  spawn(command, args, {
    cwd,
    env,
    stdio: "inherit",
  });

const waitForHealth = async (baseUrl, timeoutMs = 30000) => {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(400);
  }
  throw new Error(`Timed out waiting for health: ${baseUrl}/health (${lastError || "unknown error"})`);
};

const readEnvFile = async (path) => {
  const text = await readFile(path, "utf8");
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
};

const stopChild = async (child) => {
  if (!child || child.exitCode !== null) {
    return;
  }
  child.kill("SIGINT");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
      resolve();
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
};

const main = async () => {
  await waitForHealth(merchantOsUrl, 10000);
  await waitForHealth(facilitatorUrl, 10000);

  await copyFile(envExamplePath, envPath);
  await rm(envLocalPath, { force: true });

  await run(
    "npm",
    ["install", "--no-package-lock", "--no-save", "express", "../../packages/server-sdk"],
    { cwd: exampleDir },
  );
  await run("npm", ["run", "bootstrap:local"], { cwd: exampleDir });

  const exampleEnv = await readEnvFile(envLocalPath);
  const verificationApiKey = exampleEnv.RB_API_KEY;
  if (!verificationApiKey) {
    throw new Error("RB_API_KEY was not written to examples/merchant-sdk-minimal/.env.local");
  }

  const server = start("npm", ["start"], { cwd: exampleDir });
  try {
    await waitForHealth(merchantUrl, 15000);

    const unpaid = await fetch(`${merchantUrl}/api/premium`);
    if (unpaid.status !== 402) {
      throw new Error(`Expected unpaid request to return 402, received ${unpaid.status}`);
    }
    if (!unpaid.headers.get("payment-required")) {
      throw new Error("Expected unpaid request to include payment-required header");
    }

    await run(
      "npm",
      ["--prefix", "facilitator", "run", "test:accept-payment-existing-merchant-os"],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          RB_VERIFICATION_API_KEY: verificationApiKey,
          RB_PREFERRED_PAY_NETWORKS: "eip155:84532",
        },
      },
    );
  } finally {
    await stopChild(server);
  }
};

main().catch((error) => {
  console.error("merchant-sdk-minimal smoke test failed");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
