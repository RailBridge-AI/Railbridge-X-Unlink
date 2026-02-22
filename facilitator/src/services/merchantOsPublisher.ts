import { randomUUID } from "node:crypto";

export interface MerchantContext {
  merchantId: string;
  accountId: string;
}

interface MerchantOsPublisherConfig {
  ingestUrl?: string;
  ingestToken?: string;
  defaultContext?: MerchantContext;
  merchantContextMapJson?: string;
}

interface SettlementEventInput {
  eventId?: string;
  merchantId?: string;
  accountId?: string;
  merchantAddress: string;
  sourceNetwork: string;
  destinationNetwork?: string;
  apiId?: string;
  apiRoute?: string;
  apiName?: string;
  asset: string;
  amount: string;
  status: "settled_source" | "bridge_pending" | "bridge_confirmed" | "failed";
  txHash: string;
  sourceTxHash?: string;
  bridgeTxHash?: string;
  destinationTxHash?: string;
  blockNumber?: number;
  logIndex?: number;
  confirmations?: number;
  settlementId?: string;
}

type MerchantContextMap = Record<string, MerchantContext>;

const parseMerchantContextMap = (raw: string | undefined): MerchantContextMap => {
  if (!raw || raw.trim() === "") {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as MerchantContextMap;
    const normalized: MerchantContextMap = {};
    Object.entries(parsed).forEach(([address, value]) => {
      if (!value?.merchantId || !value?.accountId) {
        return;
      }
      normalized[address.toLowerCase()] = {
        merchantId: value.merchantId,
        accountId: value.accountId,
      };
    });
    return normalized;
  } catch (error) {
    console.warn("[merchant-os] Invalid MERCHANT_CONTEXT_MAP_JSON, default context fallback will be used");
    return {};
  }
};

export class MerchantOsPublisher {
  private readonly ingestUrl?: string;
  private readonly ingestToken?: string;
  private readonly defaultContext?: MerchantContext;
  private readonly merchantContextMap: MerchantContextMap;

  constructor(config: MerchantOsPublisherConfig) {
    this.ingestUrl = config.ingestUrl;
    this.ingestToken = config.ingestToken;
    this.defaultContext = config.defaultContext;
    this.merchantContextMap = parseMerchantContextMap(config.merchantContextMapJson);
  }

  private resolveContext(input: { merchantAddress: string; merchantId?: string; accountId?: string }): MerchantContext | null {
    if (input.merchantId && input.accountId) {
      return {
        merchantId: input.merchantId,
        accountId: input.accountId,
      };
    }

    const merchantAddress = input.merchantAddress;
    const normalizedAddress = merchantAddress.toLowerCase();
    return this.merchantContextMap[normalizedAddress] || this.defaultContext || null;
  }

  async publishSettlementEvent(input: SettlementEventInput): Promise<void> {
    if (!this.ingestUrl) {
      return;
    }

    const context = this.resolveContext(input);
    if (!context) {
      console.warn("[merchant-os] Missing merchant context for address, skipping event publish", {
        merchantAddress: input.merchantAddress,
        hint: "Set MERCHANT_OS_DEFAULT_MERCHANT_ID + MERCHANT_OS_DEFAULT_ACCOUNT_ID or MERCHANT_CONTEXT_MAP_JSON",
      });
      return;
    }

    const sourceTxHash = input.sourceTxHash || input.txHash;
    const deterministicEventId =
      input.eventId ||
      `${context.merchantId}:${context.accountId}:${input.sourceNetwork}:${input.settlementId || sourceTxHash}:${input.status}`;

    const payload = {
      eventId: deterministicEventId || randomUUID(),
      settlementId: input.settlementId || sourceTxHash,
      merchantId: context.merchantId,
      accountId: context.accountId,
      sourceNetwork: input.sourceNetwork,
      destinationNetwork: input.destinationNetwork || null,
      apiId: input.apiId || null,
      apiRoute: input.apiRoute || null,
      apiName: input.apiName || null,
      asset: input.asset,
      amount: input.amount,
      status: input.status,
      txHash: input.txHash,
      sourceTxHash,
      bridgeTxHash: input.bridgeTxHash || null,
      destinationTxHash: input.destinationTxHash || null,
      blockNumber: input.blockNumber ?? null,
      logIndex: input.logIndex ?? null,
      confirmations: input.confirmations ?? 0,
      createdAt: new Date().toISOString(),
    };

    try {
      const response = await fetch(this.ingestUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.ingestToken ? { "x-merchant-os-ingest-token": this.ingestToken } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.text();
        console.warn("[merchant-os] Failed to publish settlement event", {
          status: response.status,
          body,
          payload,
        });
      }
    } catch (error) {
      console.warn("[merchant-os] Settlement event publish error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
