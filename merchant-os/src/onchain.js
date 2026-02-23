import { nowIso } from "./utils.js";

const ERC20_BALANCE_OF_SELECTOR = "0x70a08231";

const normalizeEvmAddress = (value) => {
  if (!value || typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(text)) {
    return null;
  }
  return text.toLowerCase();
};

const buildBalanceOfData = (holderAddress) => {
  const normalized = normalizeEvmAddress(holderAddress);
  if (!normalized) {
    return null;
  }
  const body = normalized.slice(2).padStart(64, "0");
  return `${ERC20_BALANCE_OF_SELECTOR}${body}`;
};

const rpcCall = async (rpcUrl, method, params, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`RPC HTTP ${response.status}`);
    }

    const body = await response.json();
    if (body.error) {
      throw new Error(`RPC ${body.error.code}: ${body.error.message}`);
    }
    return body.result;
  } finally {
    clearTimeout(timer);
  }
};

const resolveRpcCandidates = ({ network, rpcByNetwork, rpcUrlsByNetwork }) => {
  const urls = new Set();
  const list = rpcUrlsByNetwork?.[network];
  if (Array.isArray(list)) {
    list.forEach((url) => {
      const text = String(url || "").trim();
      if (text.startsWith("http://") || text.startsWith("https://")) {
        urls.add(text);
      }
    });
  }
  const fallback = String(rpcByNetwork?.[network] || "").trim();
  if (fallback.startsWith("http://") || fallback.startsWith("https://")) {
    urls.add(fallback);
  }
  return Array.from(urls);
};

const rpcCallWithFallback = async ({
  network,
  rpcByNetwork,
  rpcUrlsByNetwork,
  method,
  params,
  timeoutMs
}) => {
  const candidates = resolveRpcCandidates({ network, rpcByNetwork, rpcUrlsByNetwork });
  if (candidates.length === 0) {
    throw new Error("RPC URL not configured");
  }

  let lastError = null;
  for (const rpcUrl of candidates) {
    try {
      return await rpcCall(rpcUrl, method, params, timeoutMs);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("RPC request failed");
};

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const fetchOnchainNativeBalance = async ({
  network,
  address,
  rpcByNetwork,
  rpcUrlsByNetwork,
  timeoutMs
}) => {
  const normalizedAddress = normalizeEvmAddress(address);
  if (!normalizedAddress) {
    return null;
  }
  const rpcCandidates = resolveRpcCandidates({ network, rpcByNetwork, rpcUrlsByNetwork });
  if (rpcCandidates.length === 0) {
    return null;
  }

  const safeTimeoutMs = Math.max(400, Number(timeoutMs || 0) || 1500);
  try {
    const hex = await rpcCallWithFallback({
      network,
      rpcByNetwork,
      rpcUrlsByNetwork,
      method: "eth_getBalance",
      params: [normalizedAddress, "latest"],
      timeoutMs: safeTimeoutMs
    });
    if (typeof hex !== "string" || !/^0x[0-9a-fA-F]+$/.test(hex)) {
      return null;
    }
    return {
      network,
      address: normalizedAddress,
      amount: BigInt(hex).toString(),
      asOf: nowIso()
    };
  } catch (error) {
    console.warn("[merchant-os] onchain native balance read failed", {
      network,
      address: normalizedAddress,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
};

export const fetchOnchainGasPrice = async ({
  network,
  rpcByNetwork,
  rpcUrlsByNetwork,
  timeoutMs
}) => {
  const rpcCandidates = resolveRpcCandidates({ network, rpcByNetwork, rpcUrlsByNetwork });
  if (rpcCandidates.length === 0) {
    return null;
  }

  const safeTimeoutMs = Math.max(400, Number(timeoutMs || 0) || 1500);
  try {
    const hex = await rpcCallWithFallback({
      network,
      rpcByNetwork,
      rpcUrlsByNetwork,
      method: "eth_gasPrice",
      params: [],
      timeoutMs: safeTimeoutMs
    });
    if (typeof hex !== "string" || !/^0x[0-9a-fA-F]+$/.test(hex)) {
      return null;
    }
    return {
      network,
      gasPriceWei: BigInt(hex).toString(),
      asOf: nowIso()
    };
  } catch (error) {
    console.warn("[merchant-os] onchain gas price read failed", {
      network,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
};

export const fetchOnchainUsdcBalancesByNetwork = async ({
  wallets,
  rpcByNetwork,
  rpcUrlsByNetwork,
  usdcTokenByNetwork,
  timeoutMs,
  totalBudgetMs
}) => {
  const result = new Map();
  const safePerCallTimeoutMs = Math.max(400, Number(timeoutMs || 0) || 1200);
  const safeTotalBudgetMs = Number(totalBudgetMs || 0) > 0 ? Math.max(500, Number(totalBudgetMs)) : 0;
  const effectivePerCallTimeoutMs = safeTotalBudgetMs
    ? Math.min(safePerCallTimeoutMs, safeTotalBudgetMs)
    : safePerCallTimeoutMs;

  const tasks = (wallets || []).map(async (wallet) => {
    const network = wallet.network;
    const rpcCandidates = resolveRpcCandidates({ network, rpcByNetwork, rpcUrlsByNetwork });
    const tokenAddress = normalizeEvmAddress(usdcTokenByNetwork[network]);
    const walletAddress = normalizeEvmAddress(wallet.address);

    if (rpcCandidates.length === 0 || !tokenAddress || !walletAddress) {
      return;
    }

    const data = buildBalanceOfData(walletAddress);
    if (!data) {
      return;
    }

    try {
      const hex = await rpcCallWithFallback({
        network,
        rpcByNetwork,
        rpcUrlsByNetwork,
        method: "eth_call",
        params: [{ to: tokenAddress, data }, "latest"],
        timeoutMs: effectivePerCallTimeoutMs
      });

      if (typeof hex !== "string" || !/^0x[0-9a-fA-F]+$/.test(hex)) {
        return;
      }

      const amount = BigInt(hex).toString();
      result.set(network, {
        network,
        asset: "USDC",
        amount,
        source: "onchain",
        asOf: nowIso()
      });
    } catch (error) {
      console.warn("[merchant-os] onchain balance read failed", {
        network,
        wallet: walletAddress,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  const allSettledPromise = Promise.allSettled(tasks);
  if (safeTotalBudgetMs > 0) {
    await Promise.race([allSettledPromise, sleep(safeTotalBudgetMs)]);
  } else {
    await allSettledPromise;
  }

  return new Map(result);
};
