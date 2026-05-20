/**
 * Bridge service types for cross-chain payments
 */

import { Network } from "@x402/core/types";

export interface BridgeConfig {
  provider: "wormhole" | "layerzero" | "cctp" | "custom";
  apiKey?: string;
  rpcUrls?: {
    [chainId: string]: string;
  };
  defaultRpcUrl?: string;
  facilitatorAddress?: string; // Facilitator address to use as bridge lock address for testing
}

/**
 * Bridge Service Interface
 * 
 * All bridge service implementations must implement this interface
 * to ensure compatibility with the facilitator and cross-chain router.
 */
export interface IBridgeService {
  /**
   * Check if bridge has sufficient liquidity on destination chain
   */
  checkLiquidity(
    sourceChain: Network,
    destChain: Network,
    asset: string,
    amount: string,
  ): Promise<boolean>;

  /**
   * Get exchange rate between source and destination assets
   */
  getExchangeRate(
    sourceChain: Network,
    destChain: Network,
    sourceAsset: string,
    destAsset: string,
  ): Promise<number>;

  /**
   * Execute bridge transaction
   * Locks funds on source chain and initiates bridge to destination
   */
  bridge(
    sourceChain: Network,
    sourceTxHash: string,
    destChain: Network,
    asset: string,
    amount: string,
    recipient: string,
  ): Promise<BridgeResult>;
}

export interface BridgeLiquidityCheck {
  hasLiquidity: boolean;
  availableAmount: string;
  sourceChain: string;
  destChain: string;
  asset: string;
}

export interface ExchangeRate {
  rate: number;
  sourceAsset: string;
  destAsset: string;
  timestamp: number;
}

export interface BridgeResult {
  bridgeTxHash: string;
  destinationTxHash: string;
  sourceChain: string;
  destChain: string;
  messageId?: string; // For tracking bridge messages
}
