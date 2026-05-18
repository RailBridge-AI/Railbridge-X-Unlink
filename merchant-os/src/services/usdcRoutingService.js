import { config } from "../config.js";

// EIP-3009 domain parameters are token-contract specific.
// Most Circle-issued USDC contracts use "USD Coin"/"2".
// Arc testnet (0x3600...) has historically required "USDC"/"2" in this demo flow.
const USDC_EIP712_DOMAIN_BY_NETWORK = {
  "eip155:84532": { name: "USDC", version: "2" },
  "eip155:5042002": { name: "USDC", version: "2" }
};

export const SOURCE_NETWORK_ANY = "any";

export const resolveUsdcDomainProfile = (network) =>
  USDC_EIP712_DOMAIN_BY_NETWORK[network] || { name: "USD Coin", version: "2" };

export const isUsdcAsset = (asset) => {
  if (!asset) {
    return false;
  }
  const normalized = String(asset).toLowerCase();
  return normalized === "usdc" || config.usdcAssetAllowlist.has(normalized);
};

export const normalizeUsdcAsset = (asset) => {
  if (!isUsdcAsset(asset)) {
    return null;
  }
  return "USDC";
};

export const normalizeSourceNetworkPreference = (value) => {
  const raw = String(value || "").trim();
  if (!raw) {
    return SOURCE_NETWORK_ANY;
  }
  const normalized = raw.toLowerCase();
  if (normalized === SOURCE_NETWORK_ANY || normalized === "*" || normalized === "all") {
    return SOURCE_NETWORK_ANY;
  }
  return raw;
};

export const isSourceNetworkAny = (value) =>
  String(value || "").trim().toLowerCase() === SOURCE_NETWORK_ANY;
