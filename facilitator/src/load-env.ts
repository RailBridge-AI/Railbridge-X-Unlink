import dotenv from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const facilitatorEnvPath = join(__dirname, "..", ".env");
const merchantOsEnvPath = join(__dirname, "..", "..", "merchant-os", ".env");

const shouldImportMerchantOsKey = (key: string) =>
  key.startsWith("MERCHANT_OS_") || key === "MERCHANT_CONTEXT_MAP_JSON";

let envLoaded = false;

export const loadFacilitatorEnv = () => {
  if (envLoaded) {
    return;
  }
  envLoaded = true;
  const shellEnvKeys = new Set(Object.keys(process.env));

  const result = dotenv.config({ path: facilitatorEnvPath });
  if (result.error) {
    console.warn(`⚠️  Could not load .env file from ${facilitatorEnvPath}`);
    console.warn("   Make sure you have created a .env file from env.template");
    console.warn(`   Error: ${result.error.message}`);
  }

  if (!existsSync(merchantOsEnvPath)) {
    return;
  }

  try {
    const parsed = dotenv.parse(readFileSync(merchantOsEnvPath, "utf8"));
    Object.entries(parsed).forEach(([key, value]) => {
      if (!shouldImportMerchantOsKey(key)) {
        return;
      }
      if (shellEnvKeys.has(key)) {
        return;
      }
      process.env[key] = value;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️  Could not read Merchant OS env from ${merchantOsEnvPath}: ${message}`);
  }
};
