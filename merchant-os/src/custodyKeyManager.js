import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;

const parseMasterKey = (value) => {
  if (!value || typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  const hex = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    return null;
  }
  return Buffer.from(hex, "hex");
};

const normalizePrivateKey = (value) => {
  if (!value || typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
};

export const isValidCustodyMasterKey = (value) => Boolean(parseMasterKey(value));

export const generateCustodyWallet = () => {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return {
    privateKey,
    address: account.address
  };
};

export const encryptCustodyPrivateKey = (privateKey, masterKeyHex) => {
  const normalizedPrivateKey = normalizePrivateKey(privateKey);
  if (!normalizedPrivateKey) {
    throw new Error("Invalid custody private key");
  }

  const key = parseMasterKey(masterKeyHex);
  if (!key || key.length !== KEY_BYTES) {
    throw new Error(
      "MERCHANT_OS_CUSTODY_MASTER_KEY must be a 32-byte hex string (64 hex chars, optional 0x prefix)"
    );
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(normalizedPrivateKey, "utf8")),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return {
    algorithm: ENCRYPTION_ALGORITHM,
    iv: iv.toString("base64"),
    encryptedPrivateKey: ciphertext.toString("base64"),
    authTag: authTag.toString("base64")
  };
};

export const decryptCustodyPrivateKey = (record, masterKeyHex) => {
  const key = parseMasterKey(masterKeyHex);
  if (!key || key.length !== KEY_BYTES) {
    throw new Error(
      "MERCHANT_OS_CUSTODY_MASTER_KEY must be a 32-byte hex string (64 hex chars, optional 0x prefix)"
    );
  }

  if (!record || record.algorithm !== ENCRYPTION_ALGORITHM) {
    throw new Error("Unsupported custody key encryption record");
  }

  const iv = Buffer.from(String(record.iv || ""), "base64");
  const ciphertext = Buffer.from(String(record.encryptedPrivateKey || ""), "base64");
  const authTag = Buffer.from(String(record.authTag || ""), "base64");

  if (!iv.length || !ciphertext.length || !authTag.length) {
    throw new Error("Malformed custody key encryption payload");
  }

  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  const privateKey = normalizePrivateKey(plaintext);
  if (!privateKey) {
    throw new Error("Decrypted custody key is invalid");
  }
  return privateKey;
};

export const encryptSecretValue = (plaintext, masterKeyHex) => {
  if (!plaintext || typeof plaintext !== "string" || !String(plaintext).trim()) {
    throw new Error("Secret value is required");
  }

  const key = parseMasterKey(masterKeyHex);
  if (!key || key.length !== KEY_BYTES) {
    throw new Error(
      "MERCHANT_OS_CUSTODY_MASTER_KEY must be a 32-byte hex string (64 hex chars, optional 0x prefix)"
    );
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(String(plaintext).trim(), "utf8")),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return {
    algorithm: ENCRYPTION_ALGORITHM,
    iv: iv.toString("base64"),
    encryptedValue: ciphertext.toString("base64"),
    authTag: authTag.toString("base64")
  };
};

export const decryptSecretValue = (record, masterKeyHex) => {
  const key = parseMasterKey(masterKeyHex);
  if (!key || key.length !== KEY_BYTES) {
    throw new Error(
      "MERCHANT_OS_CUSTODY_MASTER_KEY must be a 32-byte hex string (64 hex chars, optional 0x prefix)"
    );
  }

  if (!record || record.algorithm !== ENCRYPTION_ALGORITHM) {
    throw new Error("Unsupported secret encryption record");
  }

  const iv = Buffer.from(String(record.iv || ""), "base64");
  const ciphertext = Buffer.from(String(record.encryptedValue || ""), "base64");
  const authTag = Buffer.from(String(record.authTag || ""), "base64");

  if (!iv.length || !ciphertext.length || !authTag.length) {
    throw new Error("Malformed secret encryption payload");
  }

  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
};
