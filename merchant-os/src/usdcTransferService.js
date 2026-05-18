import { createPublicClient, createWalletClient, erc20Abi, fallback, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const normalizeEvmAddress = (value) => {
  if (!value || typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(text)) {
    return null;
  }
  return text;
};

const normalizePrivateKey = (value) => {
  if (!value || typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(text)) {
    return null;
  }
  return text;
};

const parseChainIdFromCaip2 = (network) => {
  const text = String(network || "").trim();
  const match = text.match(/^eip155:([0-9]+)$/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const resolveRpcUrls = ({ network, rpcByNetwork, rpcUrlsByNetwork }) => {
  const values = new Set();
  const fromList = rpcUrlsByNetwork?.[network];
  if (Array.isArray(fromList)) {
    fromList.forEach((url) => {
      const text = String(url || "").trim();
      if (text.startsWith("http://") || text.startsWith("https://")) {
        values.add(text);
      }
    });
  }
  const primary = String(rpcByNetwork?.[network] || "").trim();
  if (primary.startsWith("http://") || primary.startsWith("https://")) {
    values.add(primary);
  }
  return Array.from(values);
};

const buildChain = (network, chainId, rpcUrls) => ({
  id: chainId,
  name: network,
  network,
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: rpcUrls
    },
    public: {
      http: rpcUrls
    }
  }
});

const buildTransport = (rpcUrls, timeoutMs, retryCount) => {
  const transports = rpcUrls.map((url) =>
    http(url, {
      timeout: timeoutMs,
      retryCount
    })
  );
  if (transports.length === 1) {
    return transports[0];
  }
  return fallback(transports, {
    rank: false,
    retryCount
  });
};

export class UsdcTransferError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "UsdcTransferError";
    this.details = details;
  }
}

export const transferUsdcOnchain = async ({
  network,
  destinationAddress,
  amountBaseUnits,
  sourcePrivateKey,
  rpcByNetwork,
  rpcUrlsByNetwork,
  usdcTokenByNetwork,
  txTimeoutMs = 120000,
  rpcTimeoutMs = 20000,
  rpcRetryCount = 2
}) => {
  const chainId = parseChainIdFromCaip2(network);
  if (!chainId) {
    throw new UsdcTransferError("network must be CAIP-2 eip155:<chainId>", { network });
  }
  const recipient = normalizeEvmAddress(destinationAddress);
  if (!recipient) {
    throw new UsdcTransferError("destinationAddress must be a valid EVM address", {
      destinationAddress
    });
  }
  const privateKey = normalizePrivateKey(sourcePrivateKey);
  if (!privateKey) {
    throw new UsdcTransferError("sourcePrivateKey is missing or invalid");
  }
  if (!/^[0-9]+$/.test(String(amountBaseUnits || "").trim()) || BigInt(amountBaseUnits) <= 0n) {
    throw new UsdcTransferError("amountBaseUnits must be a positive base-unit string", {
      amountBaseUnits
    });
  }
  const usdcAddress = normalizeEvmAddress(usdcTokenByNetwork?.[network]);
  if (!usdcAddress) {
    throw new UsdcTransferError("USDC token address is not configured for network", { network });
  }
  const rpcUrls = resolveRpcUrls({ network, rpcByNetwork, rpcUrlsByNetwork });
  if (!rpcUrls.length) {
    throw new UsdcTransferError("RPC URL is not configured for network", { network });
  }

  const chain = buildChain(network, chainId, rpcUrls);
  const transport = buildTransport(rpcUrls, Math.max(1000, Number(rpcTimeoutMs || 0)), Math.max(0, Number(rpcRetryCount || 0)));
  const account = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({
    chain,
    transport
  });
  const walletClient = createWalletClient({
    chain,
    account,
    transport
  });

  const amount = BigInt(String(amountBaseUnits));
  const balance = await publicClient.readContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address]
  });
  if (BigInt(balance) < amount) {
    throw new UsdcTransferError("insufficient onchain USDC balance in signer wallet", {
      availableOnchain: BigInt(balance).toString(),
      requested: amount.toString(),
      signerAddress: account.address,
      usdcAddress,
      network
    });
  }

  const txHash = await walletClient.writeContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "transfer",
    args: [recipient, amount],
    account
  });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    timeout: Math.max(10000, Number(txTimeoutMs || 0))
  });
  if (receipt.status !== "success") {
    throw new UsdcTransferError("USDC transfer transaction reverted", {
      txHash,
      network,
      signerAddress: account.address
    });
  }

  return {
    txHash,
    network,
    sourceAddress: account.address,
    destinationAddress: recipient,
    usdcAddress,
    receipt
  };
};

