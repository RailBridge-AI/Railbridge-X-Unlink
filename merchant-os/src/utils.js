import { randomUUID } from "node:crypto";

export const nowIso = () => new Date().toISOString();
const MAX_BIGINT_DIGITS = 39;

export const addHoursIso = (hours) => {
  const now = Date.now();
  return new Date(now + hours * 60 * 60 * 1000).toISOString();
};

export const newId = () => randomUUID();

export const toDecimalUsdcString = (baseUnits) => {
  let value = 0n;
  try {
    value = BigInt(baseUnits);
  } catch {
    return "0";
  }
  const whole = value / 1000000n;
  const frac = value % 1000000n;
  if (frac === 0n) {
    return whole.toString();
  }

  return `${whole}.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
};

export const parsePositiveBigInt = (input, fieldName) => {
  if (typeof input !== "string" && typeof input !== "number") {
    throw new Error(`${fieldName} must be a base-unit string`);
  }
  const text = String(input).trim();
  if (!/^[0-9]+$/.test(text)) {
    throw new Error(`${fieldName} must be an unsigned integer string`);
  }
  if (text.length > MAX_BIGINT_DIGITS) {
    throw new Error(`${fieldName} is too large`);
  }
  const value = BigInt(text);
  if (value <= 0n) {
    throw new Error(`${fieldName} must be greater than zero`);
  }
  return value;
};

export const parsePositiveUsdcToBaseUnits = (input, fieldName = "amountUsdc") => {
  if (typeof input !== "string" && typeof input !== "number") {
    throw new Error(`${fieldName} must be a decimal USDC value`);
  }
  const text = String(input).trim();
  if (!/^[0-9]+(?:\.[0-9]{1,6})?$/.test(text)) {
    throw new Error(`${fieldName} must be a positive USDC amount with up to 6 decimals`);
  }

  const [wholeRaw, fracRaw = ""] = text.split(".");
  const whole = BigInt(wholeRaw);
  const frac = BigInt(fracRaw.padEnd(6, "0"));
  const value = whole * 1000000n + frac;
  if (value <= 0n) {
    throw new Error(`${fieldName} must be greater than zero`);
  }
  return value;
};

export const statusPrecedence = (status) => {
  switch (status) {
    case "failed":
      return 0;
    case "settled_source":
      return 1;
    case "bridge_pending":
      return 2;
    case "bridge_confirmed":
      return 3;
    default:
      return 1;
  }
};
