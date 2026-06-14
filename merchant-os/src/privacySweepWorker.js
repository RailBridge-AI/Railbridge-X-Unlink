import { config } from "./config.js";
import {
  acquireTenantMutationDbLock,
  getPrivateLedgerWorkflowBalances,
  insertPrivateBalanceSnapshot,
  insertPrivateLedgerEntry,
  listPendingPrivateSweepCandidates,
  markPaymentRequirementContextConsumed,
  releaseTenantMutationDbLock,
  upsertOmnibusSweep,
  upsertPrivateTransfer
} from "./db.js";

const parseAmount = (value) => {
  try {
    return BigInt(String(value || "0"));
  } catch {
    return 0n;
  }
};

const normalizeProviderStatus = (status) => {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "processed") {
    return "confirmed";
  }
  if (normalized === "failed") {
    return "failed";
  }
  return "submitted";
};

export class PrivacySweepWorker {
  constructor({ privacyVaultService, intervalMs = config.privacySweepIntervalMs } = {}) {
    this.privacyVaultService = privacyVaultService;
    this.intervalMs = Math.max(5000, Number(intervalMs) || 30000);
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = setInterval(() => {
      void this.runOnce().catch((error) => {
        console.warn("[merchant-os] privacy sweep tick failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }, this.intervalMs);
    this.timer.unref?.();
    void this.runOnce().catch((error) => {
      console.warn("[merchant-os] initial privacy sweep failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce({ limit = config.privacySweepBatchSize } = {}) {
    if (this.running) {
      return {
        success: true,
        skipped: true,
        reason: "already_running",
        candidateCount: 0,
        processedCount: 0,
        failedCount: 0,
        items: []
      };
    }

    this.running = true;
    try {
      const candidates = listPendingPrivateSweepCandidates(limit);
      const results = [];
      const grouped = new Map();

      candidates.forEach((candidate) => {
        const environment =
          String(candidate.environment || "").trim() ||
          String(
            this.privacyVaultService.getEnvironmentForNetwork(candidate.network) ||
              config.unlinkDefaultEnvironment ||
              ""
          ).trim();
        if (!environment) {
          results.push({
            settlementId: candidate.referenceId,
            merchantId: candidate.merchantId,
            accountId: candidate.accountId,
            status: "failed",
            stage: "routing",
            errorMessage: "environment_missing"
          });
          return;
        }
        const current = grouped.get(environment) || [];
        current.push({ ...candidate, environment });
        grouped.set(environment, current);
      });

      for (const [environment, items] of grouped.entries()) {
        const lockHandle = acquireTenantMutationDbLock(`privacy-sweep:${environment}`, 120000);
        if (!lockHandle) {
          items.forEach((candidate) => {
            results.push({
              settlementId: candidate.referenceId,
              merchantId: candidate.merchantId,
              accountId: candidate.accountId,
              status: "skipped",
              stage: "lock",
              errorMessage: "lock_unavailable"
            });
          });
          continue;
        }

        try {
          for (const candidate of items) {
            results.push(await this.processCandidate(candidate));
          }
        } finally {
          releaseTenantMutationDbLock(lockHandle);
        }
      }

      return {
        success: true,
        skipped: false,
        candidateCount: candidates.length,
        processedCount: results.filter((item) => item.status === "processed").length,
        failedCount: results.filter((item) => item.status === "failed").length,
        items: results
      };
    } finally {
      this.running = false;
    }
  }

  async processCandidate(candidate) {
    try {
      const amountText = String(candidate.amount || "0");
      const amount = parseAmount(amountText);
      if (amount <= 0n) {
        return {
          settlementId: candidate.referenceId,
          merchantId: candidate.merchantId,
          accountId: candidate.accountId,
          status: "failed",
          stage: "validation",
          errorMessage: "invalid_amount"
        };
      }

      const paymentContextId = candidate.metadata?.paymentContextId || null;
      const omnibusAccount = await this.privacyVaultService.ensureOmnibusAccount({
        environment: candidate.environment,
        network: candidate.network
      });
      const merchantAccount = await this.privacyVaultService.getOrCreateMerchantAccount({
        merchantId: candidate.merchantId,
        accountId: candidate.accountId,
        environment: candidate.environment,
        network: candidate.network
      });

      const sweepIdempotencyKey = `private:sweep:${candidate.environment}:${candidate.referenceId}`;
      const transferIdempotencyKey = `private:transfer:${candidate.referenceId}:${candidate.merchantId}:${candidate.accountId}`;

      const sweepResult = await this.privacyVaultService.depositFromIntake({
        environment: candidate.environment,
        network: candidate.network,
        amount: amountText,
        idempotencyKey: sweepIdempotencyKey,
        omnibusAccountRef: omnibusAccount,
        paymentContextId,
        settlementId: candidate.referenceId
      });

      upsertOmnibusSweep({
        merchantId: candidate.merchantId,
        accountId: candidate.accountId,
        provider: sweepResult.provider || "unlink",
        environment: candidate.environment,
        network: candidate.network,
        asset: candidate.asset || "USDC",
        settlementId: candidate.referenceId,
        paymentContextId,
        amount: amountText,
        omnibusAccountId: omnibusAccount?.id || null,
        providerTxId: sweepResult.txId || null,
        providerTxHash: sweepResult.txHash || null,
        status: normalizeProviderStatus(sweepResult.status),
        failReason: sweepResult.errorMessage || null,
        idempotencyKey: sweepIdempotencyKey
      });

      insertPrivateLedgerEntry({
        merchantId: candidate.merchantId,
        accountId: candidate.accountId,
        provider: sweepResult.provider || "unlink",
        environment: candidate.environment,
        network: candidate.network,
        asset: candidate.asset || "USDC",
        entryType: "omnibus.sweep_submitted",
        direction: "neutral",
        amount: amountText,
        availableDelta: "0",
        pendingSweepDelta: "0",
        pendingWithdrawalDelta: "0",
        referenceType: candidate.referenceType,
        referenceId: candidate.referenceId,
        idempotencyKey: `${sweepIdempotencyKey}:submitted`,
        metadata: {
          paymentContextId,
          providerTxId: sweepResult.txId || null,
          providerTxHash: sweepResult.txHash || null
        }
      });

      if (String(sweepResult.status) !== "processed") {
        return {
          settlementId: candidate.referenceId,
          merchantId: candidate.merchantId,
          accountId: candidate.accountId,
          status: "failed",
          stage: "sweep",
          errorMessage: sweepResult.errorMessage || "sweep_failed"
        };
      }

      insertPrivateLedgerEntry({
        merchantId: candidate.merchantId,
        accountId: candidate.accountId,
        provider: sweepResult.provider || "unlink",
        environment: candidate.environment,
        network: candidate.network,
        asset: candidate.asset || "USDC",
        entryType: "omnibus.sweep_confirmed",
        direction: "neutral",
        amount: amountText,
        availableDelta: "0",
        pendingSweepDelta: "0",
        pendingWithdrawalDelta: "0",
        referenceType: candidate.referenceType,
        referenceId: candidate.referenceId,
        idempotencyKey: `${sweepIdempotencyKey}:confirmed`,
        metadata: {
          paymentContextId,
          providerTxId: sweepResult.txId || null,
          providerTxHash: sweepResult.txHash || null
        }
      });

      const transferResult = await this.privacyVaultService.transferPrivately({
        environment: candidate.environment,
        network: candidate.network,
        amount: amountText,
        idempotencyKey: transferIdempotencyKey,
        fromAccountRef: omnibusAccount,
        toAccountRef: merchantAccount,
        toUnlinkAddress: merchantAccount.unlinkAddress,
        paymentContextId,
        settlementId: candidate.referenceId
      });

      upsertPrivateTransfer({
        merchantId: candidate.merchantId,
        accountId: candidate.accountId,
        provider: transferResult.provider || "unlink",
        environment: candidate.environment,
        network: candidate.network,
        asset: candidate.asset || "USDC",
        settlementId: candidate.referenceId,
        paymentContextId,
        amount: amountText,
        fromAccountId: omnibusAccount?.id || null,
        toAccountId: merchantAccount?.id || null,
        toUnlinkAddress: merchantAccount?.unlinkAddress || null,
        providerTxId: transferResult.txId || null,
        providerTxHash: transferResult.txHash || null,
        status: normalizeProviderStatus(transferResult.status),
        failReason: transferResult.errorMessage || null,
        idempotencyKey: transferIdempotencyKey
      });

      if (String(transferResult.status) !== "processed") {
        return {
          settlementId: candidate.referenceId,
          merchantId: candidate.merchantId,
          accountId: candidate.accountId,
          status: "failed",
          stage: "transfer",
          errorMessage: transferResult.errorMessage || "private_transfer_failed"
        };
      }

      insertPrivateLedgerEntry({
        merchantId: candidate.merchantId,
        accountId: candidate.accountId,
        provider: transferResult.provider || "unlink",
        environment: candidate.environment,
        network: candidate.network,
        asset: candidate.asset || "USDC",
        entryType: "merchant.private_credit",
        direction: "credit",
        amount: amountText,
        availableDelta: amountText,
        pendingSweepDelta: (-amount).toString(),
        pendingWithdrawalDelta: "0",
        referenceType: candidate.referenceType,
        referenceId: candidate.referenceId,
        idempotencyKey: `${transferIdempotencyKey}:ledger`,
        metadata: {
          paymentContextId,
          sweepTxId: sweepResult.txId || null,
          sweepTxHash: sweepResult.txHash || null,
          providerTxId: transferResult.txId || null,
          providerTxHash: transferResult.txHash || null,
          unlinkAddress: merchantAccount?.unlinkAddress || null
        }
      });

      if (paymentContextId) {
        markPaymentRequirementContextConsumed(paymentContextId, candidate.referenceId);
      }

      const workflowRow = getPrivateLedgerWorkflowBalances(candidate.merchantId, candidate.accountId).find(
        (row) => row.network === candidate.network
      );
      if (workflowRow) {
        insertPrivateBalanceSnapshot({
          merchantId: candidate.merchantId,
          accountId: candidate.accountId,
          provider: transferResult.provider || "unlink",
          environment: candidate.environment,
          network: candidate.network,
          asset: "USDC",
          amount: String(workflowRow.availableAmount || "0"),
          freshness: "cached",
          sourceUpdatedAt: new Date().toISOString()
        });
      }

      return {
        settlementId: candidate.referenceId,
        merchantId: candidate.merchantId,
        accountId: candidate.accountId,
        status: "processed",
        stage: "completed",
        sweepTxId: sweepResult.txId || null,
        transferTxId: transferResult.txId || null
      };
    } catch (error) {
      return {
        settlementId: candidate.referenceId,
        merchantId: candidate.merchantId,
        accountId: candidate.accountId,
        status: "failed",
        stage: "exception",
        errorMessage: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
