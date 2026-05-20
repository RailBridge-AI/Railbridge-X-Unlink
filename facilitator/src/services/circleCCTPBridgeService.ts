import { BridgeKit } from "@circle-fin/bridge-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import { createPublicClient, http } from "viem";
import type {
  BridgeConfig,
  BridgeResult,
  IBridgeService,
} from "../types/bridge.js";
import { Network } from "@x402/core/types";

/**
 * Circle CCTP Bridge Service Implementation
 * 
 * Uses Circle's Cross-Chain Transfer Protocol (CCTP) for USDC transfers.
 * Supports burn-and-mint model for native USDC bridging.
 */
export class CircleCCTPBridgeService implements IBridgeService {
  private config: BridgeConfig;
  private kit: BridgeKit;
  private adapter: ReturnType<typeof createViemAdapterFromPrivateKey> | null = null;

  // Map CAIP-2 network identifiers to Circle BridgeKit chain names
  private readonly chainNameMap: Record<string, string> = {};

  // Map CAIP-2 network identifiers to default RPC URLs
  private readonly chainRpcMap: Record<string, string> = {};

  constructor(config: BridgeConfig) {
    this.config = config;
    this.kit = new BridgeKit();

    // Build chain maps from BridgeKit supported EVM chains
    const evmChains = this.kit.getSupportedChains({ chainType: "evm" });
    evmChains.forEach(chain => {
      if (chain.type !== "evm") return;
      const caip = `eip155:${chain.chainId}`;
      this.chainNameMap[caip] = String(chain.chain);
      if (chain.rpcEndpoints?.length) {
        this.chainRpcMap[caip] = chain.rpcEndpoints[0];
      }
    });
    
    // Initialize adapter if private key is available
    const bridgeKey = process.env.FACILITATOR_EVM_PRIVATE_KEY;
    if (bridgeKey) {
      this.adapter = createViemAdapterFromPrivateKey({
        privateKey: bridgeKey as `0x${string}`,
      });
      this.registerNativeBalanceHandler();
    }
  }

  /**
   * Check if bridge has sufficient liquidity on destination chain
   * 
   * For CCTP (burn-and-mint), liquidity is always available since USDC
   * is minted on destination. However, testnets may have limitations.
   */
  async checkLiquidity(
    sourceChain: Network,
    destChain: Network,
    asset: string,
    amount: string,
  ): Promise<boolean> {
    console.log(`[CCTP] Checking liquidity: ${sourceChain} -> ${destChain}, asset: ${asset}, amount: ${amount}`);
    
    // CCTP uses burn-and-mint, so liquidity is theoretically always available
    // However, testnets may have limitations
    // For now, return true (can be enhanced with actual contract checks)
    
    // TODO: Could check if both chains support CCTP and if USDC addresses exist
    const sourceChainName = this.mapNetworkToChainName(sourceChain);
    const destChainName = this.mapNetworkToChainName(destChain);
    
    if (!sourceChainName || !destChainName) {
      console.warn(`[CCTP] Unsupported chain pair: ${sourceChain} -> ${destChain}`);
      return false;
    }

    // Check if chains are supported by Circle CCTP
    const supportedChains = this.kit.getSupportedChains();
    const sourceSupported = supportedChains.some(c => c.chain === sourceChainName);
    const destSupported = supportedChains.some(c => c.chain === destChainName);
    
    if (!sourceSupported || !destSupported) {
      console.warn(`[CCTP] Chain not supported by CCTP: ${sourceChainName} or ${destChainName}`);
      return false;
    }

    return true;
  }

  /**
   * Get exchange rate between source and destination assets
   * 
   * For USDC via CCTP, the rate is always 1:1 (same asset, burn-and-mint)
   */
  async getExchangeRate(
    sourceChain: Network,
    destChain: Network,
    sourceAsset: string,
    destAsset: string,
  ): Promise<number> {
    console.log(`[CCTP] Getting exchange rate: ${sourceAsset} -> ${destAsset}`);
    
    // For USDC via CCTP, rate is always 1:1 (same asset)
    // If different assets, would need price oracle (not supported by CCTP)
    
    if (this.isUSDC(sourceAsset) && this.isUSDC(destAsset)) {
      return 1.0;
    }
    
    // CCTP only supports USDC, so if assets differ, return 0 (not supported)
    console.warn(`[CCTP] CCTP only supports USDC transfers. Different assets not supported.`);
    return 0;
  }

  /**
   * Execute bridge transaction using Circle CCTP
   * 
   * Burns USDC on source chain and mints on destination chain
   */
  async bridge(
    sourceChain: Network,
    sourceTxHash: string,
    destChain: Network,
    asset: string,
    amount: string,
    recipient: string,
  ): Promise<BridgeResult> {
    // amount here is in on-chain base units (USDC has 6 decimals)
    // Circle BridgeKit expects a human-readable decimal string (e.g. "0.01")
    const humanAmount = this.toHumanReadableUSDC(amount);

    if (!this.adapter) {
      throw new Error(
        "FACILITATOR_EVM_PRIVATE_KEY not configured. Cannot bridge without adapter."
      );
    }

    const sourceChainName = this.mapNetworkToChainName(sourceChain);
    const destChainName = this.mapNetworkToChainName(destChain);

    if (!sourceChainName || !destChainName) {
      throw new Error(`Unsupported chain pair: ${sourceChain} -> ${destChain}`);
    }

    // Verify it's USDC (CCTP only supports USDC)
    if (!this.isUSDC(asset)) {
      throw new Error(`CCTP only supports USDC. Asset ${asset} is not supported.`);
    }

    console.log(`[CCTP] Bridging USDC:`, {
      sourceChain,
      destChain,
      sourceChainName,
      destChainName,
      rawAmount: amount,
      humanAmount,
    });
    console.log(`[CCTP] Recipient: ${recipient}`);
    console.log(`[CCTP] Source TX: ${sourceTxHash}`);

    try {
      // Wait for source transaction confirmation before bridging
      // This ensures the settlement transaction has confirmed and funds are available
      await this.waitForSourceConfirmation(sourceChain, sourceTxHash);

      // Log current pending nonce for debugging (uses shared nonce manager)
      await this.logCurrentNonce(sourceChain);

      // Execute bridge using Circle BridgeKit
      // Type assertion: sourceChainName and destChainName are validated above and match BridgeChainIdentifier
      const result = await (this.kit as any).bridge({
        from: { adapter: this.adapter as any, chain: sourceChainName as any },
        to: {
          adapter: this.adapter as any,
          chain: destChainName as any,
          recipientAddress: recipient,
        },
        amount: humanAmount,
      });

      // Extract transaction hashes from result
      const burnStep = result.steps?.find((s: { name?: string; txHash?: string }) => s.name === "burn");
      const mintStep = result.steps?.find((s: { name?: string; txHash?: string }) => s.name === "mint");

      if (result.state === "error") {
        const errorStep = result.steps?.find((s: { state?: string; name?: string; errorMessage?: string }) => s.state === "error");
        throw new Error(
          `CCTP bridge failed at step "${errorStep?.name}": ${errorStep?.errorMessage || "Unknown error"}`
        );
      }

      if (!burnStep?.txHash) {
        throw new Error("Burn transaction hash not found in bridge result");
      }

      // For CCTP, the bridge transaction is the burn transaction
      // The destination transaction is the mint transaction
      const bridgeTxHash = burnStep.txHash;
      const destinationTxHash = mintStep?.txHash || "";

      console.log(`[CCTP] Bridge successful!`);
      console.log(`[CCTP] Burn TX: ${bridgeTxHash}`);
      if (destinationTxHash) {
        console.log(`[CCTP] Mint TX: ${destinationTxHash}`);
      }

      // Extract message ID from attestation step if available
      const attestationStep = result.steps?.find((s: { name?: string; data?: unknown }) => s.name === "fetchAttestation");
      const messageId = attestationStep?.data && typeof attestationStep.data === 'object' && 'attestation' in attestationStep.data
        ? (attestationStep.data as { attestation?: string }).attestation
        : undefined;

      return {
        bridgeTxHash,
        destinationTxHash,
        sourceChain,
        destChain,
        messageId,
      };
    } catch (error) {
      console.error(`[CCTP] Bridge error:`, error);
      throw error;
    }
  }

  /**
   * Map CAIP-2 network identifier to Circle BridgeKit chain name
   */
  private mapNetworkToChainName(network: Network): string | null {
    return this.chainNameMap[network] || null;
  }

  /**
   * Check if asset is USDC (basic check by address or symbol)
   * 
   * TODO: Enhance with actual USDC address checks per chain
   */
  private isUSDC(asset: string): boolean {
    // For now, assume if it's being used with CCTP, it's USDC
    // Could enhance by checking against known USDC addresses per chain
    return true; // CCTP only supports USDC anyway
  }

  /**
   * Convert USDC amount from base units (6 decimals) to human-readable string.
   *
   * Example:
   * - "10000" (base units) -> "0.01"
   * - "1000000" (base units) -> "1"
   */
  private toHumanReadableUSDC(amount: string): string {
    const decimals = 6n;
    const base = 10n ** decimals;
    const value = BigInt(amount);

    const integer = value / base;
    const fraction = value % base;

    if (fraction === 0n) {
      return integer.toString();
    }

    let fractionStr = fraction.toString().padStart(Number(decimals), "0");
    // Trim trailing zeros
    fractionStr = fractionStr.replace(/0+$/, "");

    return `${integer.toString()}.${fractionStr}`;
  }

  /**
   * Log current pending nonce for debugging.
   * Uses pending nonce so it reflects in-flight transactions.
   */
  private async logCurrentNonce(chain: Network): Promise<void> {
    const rpcUrl = this.config.rpcUrls?.[chain] || this.chainRpcMap[chain] || this.config.defaultRpcUrl;
    const facilitatorAddress = this.config.facilitatorAddress as `0x${string}` | undefined;

    if (!rpcUrl || !facilitatorAddress) {
      return;
    }

    try {
      const publicClient = createPublicClient({
        transport: http(rpcUrl),
      });
      const pendingNonce = await publicClient.getTransactionCount({
        address: facilitatorAddress,
        blockTag: "pending",
      });
      console.log(
        JSON.stringify({
          event: "bridge_nonce",
          timestamp: new Date().toISOString(),
          chain,
          address: facilitatorAddress,
          pendingNonce,
        }),
      );
    } catch (error) {
      console.warn(`[CCTP] Failed to fetch pending nonce:`, error instanceof Error ? error.message : error);
    }
  }

  /**
   * Register a native.balanceOf handler required by provider-cctp-v2.
   * Some adapter versions do not ship this handler, which causes
   * "Action native.balanceOf is not supported" errors.
   */
  private registerNativeBalanceHandler(): void {
    if (!this.adapter) {
      return;
    }

    try {
      (this.adapter.actionRegistry as any).registerHandler(
        "native.balanceOf",
        (async (
          params: { walletAddress?: string },
          context: { chain: any; address?: string },
        ) => {
          const walletAddress = params.walletAddress ?? context.address;
          if (!walletAddress) {
            throw new Error("native.balanceOf requires walletAddress");
          }

          const publicClient = await this.adapter!.getPublicClient(context.chain);
          const balance = await publicClient.getBalance({ address: walletAddress as `0x${string}` });

          return {
            type: "noop",
            estimate: async () => ({ gas: 0n, gasPrice: 0n, fee: "0" }),
            execute: async () => balance.toString(),
          };
        }) as any,
      );
      console.log("[CCTP] Registered native.balanceOf handler");
    } catch (error) {
      console.warn(
        "[CCTP] Failed to register native.balanceOf handler:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  /**
   * Wait for source chain transaction confirmation
   * This ensures the settlement transaction has confirmed before bridging
   */
  private async waitForSourceConfirmation(
    chain: Network,
    txHash: string,
  ): Promise<void> {
    console.log(`[CCTP] Waiting for source transaction confirmation: ${chain}, TX: ${txHash}`);

    // Get RPC URL for the source chain
    const rpcUrl = this.config.rpcUrls?.[chain] || this.chainRpcMap[chain] || this.config.defaultRpcUrl;
    
    if (!rpcUrl) {
      console.warn(`[CCTP] No RPC URL found for ${chain}, skipping confirmation wait`);
      return;
    }

    try {
      // Create a public client to check transaction status
      const publicClient = createPublicClient({
        transport: http(rpcUrl),
      });

      // Wait for transaction receipt (confirmation)
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash as `0x${string}`,
        timeout: 120_000, // 2 minute timeout
      });

      console.log(`[CCTP] Source transaction confirmed: ${txHash}`);
      console.log(`[CCTP] Block number: ${receipt.blockNumber}, Status: ${receipt.status}`);
    } catch (error) {
      console.error(`[CCTP] Error waiting for source transaction confirmation:`, error);
      // Don't throw - continue with bridge attempt (Circle BridgeKit will handle balance checks)
      console.warn(`[CCTP] Continuing with bridge despite confirmation wait error`);
    }
  }

  /**
   * Get supported chains for CCTP
   */
  getSupportedChains(): string[] {
    return this.kit.getSupportedChains().map(c => c.chain);
  }
}
