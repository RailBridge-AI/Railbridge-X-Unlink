import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Network } from "@x402/core/types";

export type BridgeJobStatus = "pending" | "processing" | "retry" | "confirmed" | "failed";

export interface BridgeJob {
  id: string;
  settlementId: string;
  merchantAddress: string;
  merchantId?: string;
  accountId?: string;
  apiId?: string;
  apiRoute?: string;
  apiName?: string;
  sourceNetwork: Network;
  destinationNetwork: Network;
  destinationAsset: string;
  amount: string;
  recipient: string;
  sourceTxHash: string;
  status: BridgeJobStatus;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string;
  lastError?: string;
  bridgeTxHash?: string;
  destinationTxHash?: string;
  messageId?: string;
  createdAt: string;
  updatedAt: string;
}

type BridgeJobState = {
  jobs: BridgeJob[];
};

const nowIso = () => new Date().toISOString();

const withDefaultState = (value: unknown): BridgeJobState => {
  if (!value || typeof value !== "object") {
    return { jobs: [] };
  }
  const maybe = value as Partial<BridgeJobState>;
  return {
    jobs: Array.isArray(maybe.jobs) ? maybe.jobs : []
  };
};

export class BridgeJobStore {
  private state: BridgeJobState = { jobs: [] };

  constructor(private readonly filePath: string) {
    this.load();
  }

  private ensureParentDir(): void {
    const parent = dirname(this.filePath);
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true });
    }
  }

  private load(): void {
    this.ensureParentDir();
    if (!existsSync(this.filePath)) {
      this.state = { jobs: [] };
      this.persist();
      return;
    }
    try {
      const raw = readFileSync(this.filePath, "utf8");
      this.state = withDefaultState(JSON.parse(raw));
    } catch {
      this.state = { jobs: [] };
      this.persist();
    }
  }

  private persist(): void {
    this.ensureParentDir();
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
  }

  list(): BridgeJob[] {
    return [...this.state.jobs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  enqueue(input: Omit<BridgeJob, "status" | "attempts" | "createdAt" | "updatedAt" | "nextRetryAt">): BridgeJob {
    const createdAt = nowIso();
    const job: BridgeJob = {
      ...input,
      status: "pending",
      attempts: 0,
      nextRetryAt: createdAt,
      createdAt,
      updatedAt: createdAt
    };
    this.state.jobs.push(job);
    this.persist();
    return job;
  }

  markProcessing(jobId: string): BridgeJob | null {
    const job = this.state.jobs.find((item) => item.id === jobId);
    if (!job) {
      return null;
    }
    job.status = "processing";
    job.updatedAt = nowIso();
    this.persist();
    return job;
  }

  markConfirmed(jobId: string, patch: Partial<BridgeJob>): BridgeJob | null {
    const job = this.state.jobs.find((item) => item.id === jobId);
    if (!job) {
      return null;
    }
    Object.assign(job, patch);
    job.status = "confirmed";
    job.updatedAt = nowIso();
    this.persist();
    return job;
  }

  markFailedOrRetry(jobId: string, errorMessage: string, retryDelayMs: number): BridgeJob | null {
    const job = this.state.jobs.find((item) => item.id === jobId);
    if (!job) {
      return null;
    }

    job.attempts += 1;
    job.lastError = errorMessage;
    job.updatedAt = nowIso();

    if (job.attempts >= job.maxAttempts) {
      job.status = "failed";
      this.persist();
      return job;
    }

    const nextRetryAt = new Date(Date.now() + Math.max(1000, retryDelayMs)).toISOString();
    job.status = "retry";
    job.nextRetryAt = nextRetryAt;
    this.persist();
    return job;
  }

  getDueJobs(limit = 5): BridgeJob[] {
    const now = Date.now();
    return this.state.jobs
      .filter((job) => {
        if (job.status !== "pending" && job.status !== "retry") {
          return false;
        }
        return new Date(job.nextRetryAt).getTime() <= now;
      })
      .sort((a, b) => (a.nextRetryAt < b.nextRetryAt ? -1 : 1))
      .slice(0, Math.max(1, limit));
  }
}
