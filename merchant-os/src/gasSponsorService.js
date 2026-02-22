import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

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

const parseCaip2EvmChainId = (network) => {
  if (!network || typeof network !== "string") {
    return null;
  }
  const match = network.trim().match(/^eip155:(\d+)$/);
  if (!match) {
    return null;
  }
  const value = Number.parseInt(match[1], 10);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
};

const buildAdHocChain = (chainId, rpcUrl) => ({
  id: chainId,
  name: `EVM ${chainId}`,
  nativeCurrency: {
    name: "Native",
    symbol: "ETH",
    decimals: 18
  },
  rpcUrls: {
    default: { http: [rpcUrl] },
    public: { http: [rpcUrl] }
  }
});

const sanitizeTopupAmount = (value) => {
  try {
    const amount = BigInt(value);
    return amount > 0n ? amount : null;
  } catch {
    return null;
  }
};

export class GasSponsorService {
  constructor({ privateKey, rpcByNetwork }) {
    this.rpcByNetwork = rpcByNetwork || {};
    this.privateKey = normalizePrivateKey(privateKey);
    this.account = this.privateKey ? privateKeyToAccount(this.privateKey) : null;
  }

  isReady() {
    return Boolean(this.account);
  }

  getSponsorAddress() {
    return this.account?.address || null;
  }

  supportsNetwork(network) {
    return Boolean(this.rpcByNetwork?.[network] && parseCaip2EvmChainId(network));
  }

  async topUp({
    network,
    to,
    amountWei,
    receiptTimeoutMs = 120000
  }) {
    if (!this.isReady()) {
      throw new Error("Gas sponsor private key is not configured");
    }
    if (!this.supportsNetwork(network)) {
      throw new Error(`Unsupported gas sponsor network: ${network}`);
    }

    const targetAddress = normalizeEvmAddress(to);
    if (!targetAddress) {
      throw new Error("Invalid gas top-up recipient address");
    }
    const sponsorAddress = normalizeEvmAddress(this.account.address);
    if (sponsorAddress && targetAddress.toLowerCase() === sponsorAddress.toLowerCase()) {
      return {
        skipped: true,
        reason: "target_is_sponsor",
        sponsorAddress,
        targetAddress
      };
    }

    const value = sanitizeTopupAmount(amountWei);
    if (!value) {
      throw new Error("Gas top-up amount must be a positive integer (wei)");
    }

    const rpcUrl = this.rpcByNetwork[network];
    const chainId = parseCaip2EvmChainId(network);
    if (!rpcUrl || !chainId) {
      throw new Error(`Invalid chain RPC config for ${network}`);
    }

    const chain = buildAdHocChain(chainId, rpcUrl);
    const transport = http(rpcUrl, { timeout: 12000 });
    const publicClient = createPublicClient({ chain, transport });
    const walletClient = createWalletClient({
      account: this.account,
      chain,
      transport
    });

    const sponsorBalance = await publicClient.getBalance({ address: this.account.address });
    if (sponsorBalance < value) {
      throw new Error(
        `Gas sponsor wallet has insufficient native balance on ${network} (needed=${value.toString()} wei, available=${sponsorBalance.toString()} wei)`
      );
    }

    const txHash = await walletClient.sendTransaction({
      account: this.account,
      to: targetAddress,
      value
    });

    await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: Math.max(30000, Number(receiptTimeoutMs || 0) || 120000)
    });

    return {
      skipped: false,
      txHash,
      sponsorAddress,
      targetAddress,
      amountWei: value.toString(),
      network
    };
  }
}

