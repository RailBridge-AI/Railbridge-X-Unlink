const NETWORK_DISPLAY = {
  "eip155:42161": { name: "Arbitrum", logo: "arbitrum.svg" },
  "eip155:43114": { name: "Avalanche", logo: "avax.png" },
  "eip155:8453": { name: "Base", logo: "base.png" },
  "eip155:81224": { name: "Codex Mainnet", logo: null },
  "eip155:1": { name: "Ethereum", logo: "ethereum.svg" },
  "eip155:999": { name: "HyperEVM", logo: "hype.png" },
  "eip155:57073": { name: "Ink", logo: "ink.png" },
  "eip155:59144": { name: "Linea", logo: "Linea.png" },
  "eip155:143": { name: "Monad", logo: "monad.png" },
  "eip155:10": { name: "Optimism", logo: "optimism.svg" },
  "eip155:98866": { name: "Plume", logo: "plume.svg" },
  "eip155:137": { name: "Polygon", logo: "polygon.svg" },
  "eip155:1329": { name: "Sei", logo: "sei.png" },
  "eip155:146": { name: "Sonic", logo: "sonic.png" },
  "eip155:130": { name: "Unichain", logo: "unichain.svg" },
  "eip155:480": { name: "World Chain", logo: "worldcoin.svg" },
  "eip155:421614": { name: "Arbitrum Sepolia", logo: "arbitrum.svg" },
  "eip155:5042002": { name: "Arc Testnet", logo: "arc.jpg" },
  "eip155:43113": { name: "Avalanche Fuji", logo: "avax.png" },
  "eip155:84532": { name: "Base Sepolia", logo: "base.png" },
  "eip155:11155111": { name: "Ethereum Sepolia", logo: "ethereum.svg" },
  "eip155:998": { name: "HyperEVM Testnet", logo: "hype.png" },
  "eip155:763373": { name: "Ink Sepolia", logo: "ink.png" },
  "eip155:59141": { name: "Linea Sepolia", logo: "Linea.png" },
  "eip155:10143": { name: "Monad Testnet", logo: "monad.png" },
  "eip155:11155420": { name: "Optimism Sepolia", logo: "optimism.svg" },
  "eip155:98867": { name: "Plume Testnet", logo: "plume.svg" },
  "eip155:80002": { name: "Polygon Amoy", logo: "polygon.svg" },
  "eip155:1328": { name: "Sei Testnet", logo: "sei.png" },
  "eip155:14601": { name: "Sonic Testnet", logo: "sonic.png" },
  "eip155:1301": { name: "Unichain Sepolia", logo: "unichain.svg" },
  "eip155:4801": { name: "World Chain Sepolia", logo: "worldcoin.svg" }
};

const TOKEN_DISPLAY = {
  USDC: { symbol: "USDC", logo: "/token-logos/usdc.svg" }
};

const TESTNET_NETWORKS = new Set([
  "eip155:421614",
  "eip155:5042002",
  "eip155:43113",
  "eip155:84532",
  "eip155:11155111",
  "eip155:998",
  "eip155:763373",
  "eip155:59141",
  "eip155:10143",
  "eip155:11155420",
  "eip155:98867",
  "eip155:80002",
  "eip155:1328",
  "eip155:14601",
  "eip155:1301",
  "eip155:4801"
]);

export const getNetworkInfo = (network) => {
  const info = NETWORK_DISPLAY[String(network || "")];
  if (info) {
    return {
      name: info.name,
      logo: info.logo ? `/chain-logos/${info.logo}` : null
    };
  }
  return {
    name: String(network || "Unknown network"),
    logo: null
  };
};

export const getTokenInfo = (asset) => {
  const normalizedAsset = String(asset || "USDC").toUpperCase();
  const token = TOKEN_DISPLAY[normalizedAsset];
  if (token) {
    return token;
  }
  return { symbol: normalizedAsset, logo: null };
};

export const isTestnetNetwork = (network) => {
  const normalized = String(network || "");
  if (TESTNET_NETWORKS.has(normalized)) {
    return true;
  }
  const { name } = getNetworkInfo(normalized);
  return /testnet|sepolia|fuji|amoy|devnet/i.test(name);
};

export const isLocalDevelopmentHost = (hostname) => {
  const normalized = String(
    hostname ??
      (typeof window !== "undefined" ? window.location.hostname : "")
  )
    .trim()
    .toLowerCase();

  if (!normalized) {
    return false;
  }
  if (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  ) {
    return true;
  }
  if (normalized.endsWith(".local")) {
    return true;
  }
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(normalized)) {
    return true;
  }
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized)) {
    return true;
  }
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(normalized)) {
    return true;
  }
  return false;
};

export const isTestnetDeploymentHost = (hostname) => {
  const normalized = String(
    hostname ??
      (typeof window !== "undefined" ? window.location.hostname : "")
  )
    .trim()
    .toLowerCase();

  if (!normalized) {
    return false;
  }

  return (
    normalized === "testnet.railbridge.ai" ||
    normalized.endsWith(".testnet.railbridge.ai")
  );
};

export const shouldPreferTestnetsInUi = (hostname) =>
  isLocalDevelopmentHost(hostname) || isTestnetDeploymentHost(hostname);

export const compareNetworksForDisplay = (leftNetwork, rightNetwork) => {
  const leftIsTestnet = isTestnetNetwork(leftNetwork);
  const rightIsTestnet = isTestnetNetwork(rightNetwork);
  if (leftIsTestnet !== rightIsTestnet) {
    return leftIsTestnet ? -1 : 1;
  }

  const leftName = getNetworkInfo(leftNetwork).name.toLowerCase();
  const rightName = getNetworkInfo(rightNetwork).name.toLowerCase();
  if (leftName < rightName) {
    return -1;
  }
  if (leftName > rightName) {
    return 1;
  }
  return String(leftNetwork || "").localeCompare(String(rightNetwork || ""));
};

export const formatUsdcBaseUnits = (value) => {
  const n = Number(value || 0) / 1e6;
  if (!Number.isFinite(n)) {
    return "0";
  }
  return n.toFixed(n % 1 === 0 ? 0 : 3);
};
