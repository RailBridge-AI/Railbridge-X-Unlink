import type { BridgeResult } from "./types/bridge.js";
import type { CircleCCTPBridgeService } from "./services/circleCCTPBridgeService.js";
import type { Network } from "@x402/core/types";

const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 1000;

type BridgeLogEvent =
  | "bridge_start"
  | "bridge_attempt"
  | "bridge_success"
  | "bridge_failure";

function logBridgeEvent(event: BridgeLogEvent, payload: Record<string, unknown>): void {
  const entry = {
    event,
    timestamp: new Date().toISOString(),
    ...payload,
  };
  console.log(JSON.stringify(entry));
}

type CircleErrorLike = {
  recoverability?: string;
  message?: string;
};

export interface BridgeLifecycleCallbacks {
  onSuccess?: (result: BridgeResult) => void | Promise<void>;
  onFailure?: (error: unknown) => void | Promise<void>;
}

/**
 * Decide whether a bridge error is retryable.
 * Uses Circle CCTP error shape when available (code, type, recoverability, cause).
 */
export function isRetryableBridgeError(error: unknown): boolean {
  const err = error as CircleErrorLike;

  if (err?.recoverability === "FATAL") {
    return false;
  }

  const msg = (err?.message || String(err)).toLowerCase();
  if (msg.includes("insufficient usdc balance") || msg.includes("insufficient token balance")) {
    return false;
  }

  if (msg.includes("nonce too low") || msg.includes("failed to fetch") || msg.includes("gateway timeout")) {
    return true;
  }

  return true;
}

/**
 * Attempt to bridge funds with retry logic.
 * Returns the bridge result on success, throws on permanent failure.
 */
export async function attemptBridgeWithRetry(
  bridgeService: CircleCCTPBridgeService,
  sourceNetwork: Network,
  sourceTxHash: string,
  destinationNetwork: Network,
  destinationAsset: string,
  amount: string,
  recipient: string,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): Promise<BridgeResult> {
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      logBridgeEvent("bridge_attempt", {
        attempt,
        maxAttempts,
        sourceNetwork,
        sourceTx: sourceTxHash,
        destinationNetwork,
        destinationAsset,
        amount,
      });
      const bridgeResult = await bridgeService.bridge(
        sourceNetwork,
        sourceTxHash,
        destinationNetwork,
        destinationAsset,
        amount,
        recipient,
      );
      return bridgeResult;
    } catch (err) {
      lastError = err;
      const retryable = isRetryableBridgeError(err);

      logBridgeEvent("bridge_failure", {
        attempt,
        maxAttempts,
        retryable,
        error: err instanceof Error ? err.message : String(err),
        errorCode: (err as any)?.code,
        errorType: (err as any)?.type,
        recoverability: (err as any)?.recoverability,
        sourceTx: sourceTxHash,
        sourceNetwork,
        destinationNetwork,
        destinationAsset,
        amount,
      });

      if (!retryable || attempt >= maxAttempts) {
        break;
      }

      const delayMs = attempt * BASE_RETRY_DELAY_MS;
      console.log(`⏳ Waiting ${delayMs}ms before next bridge attempt`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError || new Error("Bridge failed after all retry attempts");
}

/**
 * Handle cross-chain bridging asynchronously after settlement.
 * This runs in the background and does not block the settlement response.
 */
export function handleCrossChainBridgeAsync(
  bridgeService: CircleCCTPBridgeService,
  sourceNetwork: Network,
  sourceTxHash: string,
  destinationNetwork: Network,
  destinationAsset: string,
  amount: string,
  recipient: string,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
  callbacks?: BridgeLifecycleCallbacks,
): void {
  void (async () => {
    try {
      logBridgeEvent("bridge_start", {
        sourceNetwork,
        sourceTx: sourceTxHash,
        destinationNetwork,
        destinationAsset,
        amount,
        maxAttempts,
      });

      const bridgeResult = await attemptBridgeWithRetry(
        bridgeService,
        sourceNetwork,
        sourceTxHash,
        destinationNetwork,
        destinationAsset,
        amount,
        recipient,
        maxAttempts,
      );

      logBridgeEvent("bridge_success", {
        sourceTx: sourceTxHash,
        sourceNetwork,
        destinationNetwork,
        destinationAsset,
        amount,
        bridgeTx: bridgeResult.bridgeTxHash,
        destinationTx: bridgeResult.destinationTxHash,
        messageId: bridgeResult.messageId,
      });

      if (callbacks?.onSuccess) {
        await callbacks.onSuccess(bridgeResult);
      }
    } catch (error) {
      logBridgeEvent("bridge_failure", {
        error: error instanceof Error ? error.message : String(error),
        errorCode: (error as any)?.code,
        errorType: (error as any)?.type,
        recoverability: (error as any)?.recoverability,
        sourceTx: sourceTxHash,
        sourceNetwork,
        destinationNetwork,
        destinationAsset,
        amount,
        attempts: maxAttempts,
      });

      if (callbacks?.onFailure) {
        await callbacks.onFailure(error);
      }
    }
  })();
}
