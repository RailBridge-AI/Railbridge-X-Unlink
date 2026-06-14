import {
  createPayoutRequest,
  getPayoutRequest,
  getPolicy,
  getPrivateLedgerWorkflowBalances,
  insertPrivateBalanceSnapshot,
  insertPrivateLedgerEntry,
  updatePayoutStatus,
  upsertWithdrawalBatch
} from "./db.js";
import { privacyVaultService } from "./privacyVaultService.js";

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

const publishPayoutWebhook = async ({ publishTenantWebhookEvent, merchantId, accountId, payout, eventType }) => {
  if (typeof publishTenantWebhookEvent !== "function") {
    return;
  }
  await publishTenantWebhookEvent({
    merchantId,
    accountId,
    eventType,
    eventId: `evt_${payout.id}_${eventType.split(".")[1] || "updated"}`,
    data: payout
  });
};

export const executePrivatePayout = async ({
  merchantId,
  accountId,
  network,
  destinationAddress,
  amount,
  publishTenantWebhookEvent
}) => {
  const policy = getPolicy(merchantId, accountId);
  const privateHomeNetwork = String(policy?.privateHomeNetwork || "").trim();
  if (!privateHomeNetwork) {
    return {
      ok: false,
      statusCode: 400,
      payload: { error: "privateHomeNetwork is not configured for this account" }
    };
  }
  if (network !== privateHomeNetwork) {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        error: "private payouts must use the account private home network",
        network,
        privateHomeNetwork
      }
    };
  }

  const environment =
    privacyVaultService.getEnvironmentForNetwork(network) || null;
  if (!environment) {
    return {
      ok: false,
      statusCode: 400,
      payload: { error: "unlink environment is not configured for this network" }
    };
  }

  const workflowRow = getPrivateLedgerWorkflowBalances(merchantId, accountId).find(
    (row) => row.network === network
  );
  const availableAmount = parseAmount(workflowRow?.availableAmount || "0");
  if (availableAmount < amount) {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        error: "insufficient private balance",
        available: availableAmount.toString(),
        availableSource: "private_ledger"
      }
    };
  }

  const amountText = amount.toString();
  const payoutId = createPayoutRequest({
    merchantId,
    accountId,
    network,
    amount: amountText,
    destinationAddress
  });

  insertPrivateLedgerEntry({
    merchantId,
    accountId,
    provider: "unlink",
    environment,
    network,
    asset: "USDC",
    entryType: "merchant.withdrawal_requested",
    direction: "debit",
    amount: amountText,
    availableDelta: (-amount).toString(),
    pendingSweepDelta: "0",
    pendingWithdrawalDelta: amountText,
    referenceType: "payout",
    referenceId: payoutId,
    idempotencyKey: `private:withdrawal:request:${payoutId}`,
    metadata: {
      destinationAddress
    }
  });

  updatePayoutStatus(payoutId, "submitted");

  const merchantAccount = await privacyVaultService.getOrCreateMerchantAccount({
    merchantId,
    accountId,
    environment,
    network
  });

  insertPrivateLedgerEntry({
    merchantId,
    accountId,
    provider: "unlink",
    environment,
    network,
    asset: "USDC",
    entryType: "merchant.withdrawal_submitted",
    direction: "neutral",
    amount: amountText,
    availableDelta: "0",
    pendingSweepDelta: "0",
    pendingWithdrawalDelta: "0",
    referenceType: "payout",
    referenceId: payoutId,
    idempotencyKey: `private:withdrawal:submitted:${payoutId}`,
    metadata: {
      destinationAddress,
      unlinkAddress: merchantAccount?.unlinkAddress || null
    }
  });

  const withdrawIdempotencyKey = `private:withdrawal:submit:${payoutId}`;
  const withdrawResult = await privacyVaultService.withdrawToEvm({
    environment,
    network,
    amount: amountText,
    idempotencyKey: withdrawIdempotencyKey,
    merchantAccountRef: merchantAccount,
    recipientEvmAddress: destinationAddress,
    payoutId
  });

  upsertWithdrawalBatch({
    merchantId,
    accountId,
    provider: withdrawResult.provider || "unlink",
    environment,
    network,
    asset: "USDC",
    payoutId,
    destinationAddress,
    amount: amountText,
    fromAccountId: merchantAccount?.id || null,
    providerTxId: withdrawResult.txId || null,
    providerTxHash: withdrawResult.txHash || null,
    status: normalizeProviderStatus(withdrawResult.status),
    failReason: withdrawResult.errorMessage || null,
    idempotencyKey: withdrawIdempotencyKey
  });

  if (String(withdrawResult.status) !== "processed") {
    insertPrivateLedgerEntry({
      merchantId,
      accountId,
      provider: withdrawResult.provider || "unlink",
      environment,
      network,
      asset: "USDC",
      entryType: "merchant.withdrawal_failed",
      direction: "credit",
      amount: amountText,
      availableDelta: amountText,
      pendingSweepDelta: "0",
      pendingWithdrawalDelta: (-amount).toString(),
      referenceType: "payout",
      referenceId: payoutId,
      idempotencyKey: `private:withdrawal:failed:${payoutId}`,
      metadata: {
        destinationAddress,
        providerTxId: withdrawResult.txId || null,
        providerTxHash: withdrawResult.txHash || null,
        errorCode: withdrawResult.errorCode || null,
        errorMessage: withdrawResult.errorMessage || null
      }
    });

    updatePayoutStatus(payoutId, "failed", {
      failReason: withdrawResult.errorMessage || "private withdrawal failed",
      txHash: withdrawResult.txHash || null
    });
    const payout = getPayoutRequest(payoutId);
    await publishPayoutWebhook({
      publishTenantWebhookEvent,
      merchantId,
      accountId,
      payout,
      eventType: "payout.failed"
    });
    return {
      ok: false,
      statusCode: 502,
      payload: {
        error: "private payout execution failed",
        details: withdrawResult.errorMessage || "private withdrawal failed",
        payout
      }
    };
  }

  insertPrivateLedgerEntry({
    merchantId,
    accountId,
    provider: withdrawResult.provider || "unlink",
    environment,
    network,
    asset: "USDC",
    entryType: "merchant.withdrawal_confirmed",
    direction: "debit",
    amount: amountText,
    availableDelta: "0",
    pendingSweepDelta: "0",
    pendingWithdrawalDelta: (-amount).toString(),
    referenceType: "payout",
    referenceId: payoutId,
    idempotencyKey: `private:withdrawal:confirmed:${payoutId}`,
    metadata: {
      destinationAddress,
      providerTxId: withdrawResult.txId || null,
      providerTxHash: withdrawResult.txHash || null
    }
  });

  const workflowAfter = getPrivateLedgerWorkflowBalances(merchantId, accountId).find(
    (row) => row.network === network
  );
  if (workflowAfter) {
    insertPrivateBalanceSnapshot({
      merchantId,
      accountId,
      provider: withdrawResult.provider || "unlink",
      environment,
      network,
      asset: "USDC",
      amount: String(workflowAfter.availableAmount || "0"),
      freshness: "cached",
      sourceUpdatedAt: new Date().toISOString()
    });
  }

  updatePayoutStatus(payoutId, "completed", {
    txHash: withdrawResult.txHash || null,
    failReason: null
  });
  const payout = getPayoutRequest(payoutId);
  await publishPayoutWebhook({
    publishTenantWebhookEvent,
    merchantId,
    accountId,
    payout,
    eventType: "payout.completed"
  });

  return {
    ok: true,
    statusCode: 201,
    payout
  };
};
