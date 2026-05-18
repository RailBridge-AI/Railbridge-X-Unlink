import { randomBytes } from "node:crypto";

const buildToken = (prefix) => `${prefix}_${randomBytes(24).toString("hex")}`;

const tokens = {
  MERCHANT_OS_INGEST_TOKEN: buildToken("mos_ingest"),
  MERCHANT_OS_INTERNAL_TOKEN: buildToken("mos_internal"),
  MERCHANT_OS_ADMIN_TOKEN: buildToken("mos_admin"),
};

const now = new Date().toISOString();

console.log(`# Generated ${now}`);
console.log("# Paste into merchant-os/.env");
Object.entries(tokens).forEach(([key, value]) => {
  console.log(`${key}=${value}`);
});

console.log("");
console.log("# Facilitator integration note:");
console.log(
  "# facilitator/.env should use the same MERCHANT_OS_INGEST_TOKEN when posting /v1/internal/events/settlements"
);
