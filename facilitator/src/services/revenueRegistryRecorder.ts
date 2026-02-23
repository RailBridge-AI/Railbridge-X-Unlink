import { defineChain, createWalletClient, createPublicClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const REVENUE_REGISTRY_ABI = [
  {
    type: "function",
    name: "recordSettlement",
    stateMutability: "nonpayable",
    inputs: [
      { name: "settlementId", type: "bytes32" },
      { name: "merchantId", type: "string" },
      { name: "apiId", type: "string" },
      { name: "amount", type: "uint256" },
      { name: "payer", type: "address" },
      { name: "sourceTxHash", type: "bytes32" }
    ],
    outputs: []
  }
] as const;

const ARBITRUM_SEPOLIA = defineChain({
  id: 421614,
  name: "Arbitrum Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://sepolia-rollup.arbitrum.io/rpc"] } },
  blockExplorers: {
    default: { name: "Arbiscan", url: "https://sepolia.arbiscan.io" }
  },
  testnet: true
});

const isHex32 = (value: unknown): value is Hex =>
  typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);

const normalizeAddress = (value: unknown): Address | null => {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(text)) {
    return null;
  }
  return text as Address;
};

export type RevenueSettlementInput = {
  settlementId: Hex;
  sourceTxHash: Hex;
  merchantId: string;
  apiId: string;
  amount: string;
  payer: Address;
};

type RecorderConfig = {
  enabled: boolean;
  contractAddress?: Address;
  rpcUrl?: string;
  privateKey: Hex;
};

export class RevenueRegistryRecorder {
  private readonly enabled: boolean;
  private readonly contractAddress?: Address;
  private readonly walletClient;
  private readonly publicClient;

  constructor(cfg: RecorderConfig) {
    this.enabled = Boolean(cfg.enabled && cfg.contractAddress);
    this.contractAddress = cfg.contractAddress;

    const rpcUrl = cfg.rpcUrl || "https://sepolia-rollup.arbitrum.io/rpc";
    const account = privateKeyToAccount(cfg.privateKey);

    this.walletClient = createWalletClient({
      account,
      chain: {
        ...ARBITRUM_SEPOLIA,
        rpcUrls: { default: { http: [rpcUrl] } }
      },
      transport: http(rpcUrl)
    });

    this.publicClient = createPublicClient({
      chain: {
        ...ARBITRUM_SEPOLIA,
        rpcUrls: { default: { http: [rpcUrl] } }
      },
      transport: http(rpcUrl)
    });
  }

  isEnabled() {
    return this.enabled;
  }

  async recordSettlement(input: RevenueSettlementInput): Promise<Hex | null> {
    if (!this.enabled || !this.contractAddress) {
      return null;
    }

    if (!isHex32(input.settlementId) || !isHex32(input.sourceTxHash)) {
      throw new Error("settlementId/sourceTxHash must be bytes32 hex");
    }

    const payer = normalizeAddress(input.payer);
    if (!payer) {
      throw new Error("payer must be a valid address");
    }

    const amount = BigInt(String(input.amount));

    const txHash = await this.walletClient.writeContract({
      address: this.contractAddress,
      abi: REVENUE_REGISTRY_ABI,
      functionName: "recordSettlement",
      args: [
        input.settlementId,
        String(input.merchantId || "unknown"),
        String(input.apiId || "unknown"),
        amount,
        payer,
        input.sourceTxHash
      ]
    });

    await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    return txHash;
  }
}
