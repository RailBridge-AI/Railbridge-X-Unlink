import type { Network } from "@x402/core/types";
import type { BridgeResult } from "../types/bridge.js";
import type { CircleCCTPBridgeService } from "./circleCCTPBridgeService.js";
import type { MerchantOsPublisher } from "./merchantOsPublisher.js";
import { BridgeJobStore, type BridgeJob } from "./bridgeJobStore.js";

interface BridgeJobWorkerConfig {
  store: BridgeJobStore;
  bridgeService: CircleCCTPBridgeService;
  merchantOsPublisher: MerchantOsPublisher;
  intervalMs: number;
  retryBaseMs: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class BridgeJobWorker {
  private readonly store: BridgeJobStore;
  private readonly bridgeService: CircleCCTPBridgeService;
  private readonly merchantOsPublisher: MerchantOsPublisher;
  private readonly intervalMs: number;
  private readonly retryBaseMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(config: BridgeJobWorkerConfig) {
    this.store = config.store;
    this.bridgeService = config.bridgeService;
    this.merchantOsPublisher = config.merchantOsPublisher;
    this.intervalMs = Math.max(2000, config.intervalMs);
    this.retryBaseMs = Math.max(1000, config.retryBaseMs);
  }

  start(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  listJobs(): BridgeJob[] {
    return this.store.list();
  }

  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;

    try {
      const due = this.store.getDueJobs(5);
      for (const job of due) {
        const processing = this.store.markProcessing(job.id);
        if (!processing) {
          continue;
        }
        await this.processJob(processing);
      }
    } finally {
      this.running = false;
    }
  }

  private async publishConfirmed(job: BridgeJob, bridgeResult: BridgeResult): Promise<void> {
    await this.merchantOsPublisher.publishSettlementEvent({
      eventId: `${job.settlementId}:bridge_confirmed`,
      merchantAddress: job.recipient,
      merchantId: job.merchantId,
      accountId: job.accountId,
      sourceNetwork: job.sourceNetwork,
      destinationNetwork: job.destinationNetwork,
      apiId: job.apiId,
      apiRoute: job.apiRoute,
      apiName: job.apiName,
      asset: job.destinationAsset,
      amount: job.amount,
      status: "bridge_confirmed",
      txHash: bridgeResult.destinationTxHash || bridgeResult.bridgeTxHash || job.sourceTxHash,
      sourceTxHash: job.sourceTxHash,
      bridgeTxHash: bridgeResult.bridgeTxHash || undefined,
      destinationTxHash: bridgeResult.destinationTxHash || undefined,
      settlementId: job.settlementId
    });
  }

  private async publishFailed(job: BridgeJob, errorMessage: string): Promise<void> {
    await this.merchantOsPublisher.publishSettlementEvent({
      eventId: `${job.settlementId}:failed`,
      merchantAddress: job.recipient,
      merchantId: job.merchantId,
      accountId: job.accountId,
      sourceNetwork: job.sourceNetwork,
      destinationNetwork: job.destinationNetwork,
      apiId: job.apiId,
      apiRoute: job.apiRoute,
      apiName: job.apiName,
      asset: job.destinationAsset,
      amount: job.amount,
      status: "failed",
      txHash: job.sourceTxHash,
      sourceTxHash: job.sourceTxHash,
      settlementId: job.settlementId
    });

    console.error("[bridge-worker] job permanently failed", {
      jobId: job.id,
      settlementId: job.settlementId,
      attempts: job.attempts,
      error: errorMessage
    });
  }

  private async processJob(job: BridgeJob): Promise<void> {
    try {
      const result = await this.bridgeService.bridge(
        job.sourceNetwork,
        job.sourceTxHash,
        job.destinationNetwork,
        job.destinationAsset,
        job.amount,
        job.recipient
      );

      const updated = this.store.markConfirmed(job.id, {
        bridgeTxHash: result.bridgeTxHash,
        destinationTxHash: result.destinationTxHash,
        messageId: result.messageId
      });

      if (updated) {
        await this.publishConfirmed(updated, result);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const nextDelay = this.retryBaseMs * Math.max(1, job.attempts + 1);
      const updated = this.store.markFailedOrRetry(job.id, message, nextDelay);
      if (!updated) {
        return;
      }

      if (updated.status === "failed") {
        await this.publishFailed(updated, message);
        return;
      }

      console.warn("[bridge-worker] bridge retry scheduled", {
        jobId: updated.id,
        settlementId: updated.settlementId,
        attempts: updated.attempts,
        nextRetryAt: updated.nextRetryAt,
        error: message
      });
      await sleep(10);
    }
  }
}
