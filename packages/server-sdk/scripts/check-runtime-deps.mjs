import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const packageJsonPath = resolve(import.meta.dirname, "..", "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const dependencies = packageJson.dependencies || {};

const forbiddenDirectDependencies = new Map([
  ["@x402/paywall", "UI/browser paywall package; pulls in wallet, React, and multi-chain frontend dependencies"],
  ["react", "server SDK should not depend on React"],
  ["react-dom", "server SDK should not depend on ReactDOM"],
  ["wagmi", "server SDK should not depend on browser wallet tooling"],
  ["@wagmi/core", "server SDK should not depend on browser wallet tooling"],
  ["@wagmi/connectors", "server SDK should not depend on browser wallet tooling"],
  ["@walletconnect/sign-client", "server SDK should not depend on walletconnect client packages"],
  ["@txnlab/use-wallet", "server SDK should not depend on browser wallet packages"],
  ["@perawallet/connect", "server SDK should not depend on browser wallet packages"],
  ["lute-connect", "server SDK should not depend on browser wallet packages"],
  ["@blockshake/defly-connect", "server SDK should not depend on browser wallet packages"]
]);

const failures = [];
for (const [name, reason] of forbiddenDirectDependencies.entries()) {
  if (Object.hasOwn(dependencies, name)) {
    failures.push(`${name}: ${reason}`);
  }
}

if (failures.length) {
  console.error("[merchant-sdk] forbidden direct runtime dependencies found:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("[merchant-sdk] runtime dependency guard passed");
