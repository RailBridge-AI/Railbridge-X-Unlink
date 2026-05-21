import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer } from "@x402/core/server";
import { HTTPFacilitatorClient } from "@x402/core/http";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { createPaywall } from "@x402/paywall";
import { evmPaywall } from "@x402/paywall/evm";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import type { RequestHandler } from "express";
import { CROSS_CHAIN, declareCrossChainExtension } from "../extensions/crossChain.js";

const DEFAULT_SUPPORTED_NETWORKS: Array<`${string}:${string}`> = [
  "eip155:421614",
  "eip155:5042002",
  "eip155:84532",
  "eip155:11155111",
  "eip155:8453",
  "eip155:137",
  "eip155:1",
] as const;
const DEFAULT_MAX_REQUIREMENT_OPTIONS = 8;
const PREFERRED_REQUIREMENT_NETWORKS: Array<`${string}:${string}`> = [
  "eip155:84532",
  "eip155:421614",
  "eip155:11155111",
  "eip155:5042002",
  "eip155:8453",
  "eip155:42161",
  "eip155:10",
  "eip155:1",
  "eip155:137",
] as const;

const SUPPORTED_SETTLEMENT_MODES = new Set(["same_chain", "cross_chain"]);
const FACILITATOR_SUPPORTED_ENDPOINT = "/supported";
const FACILITATOR_CHAINS_ENDPOINT = "/chains";

export type MerchantOsPaymentGuardConfig = {
  facilitatorUrl: string;
  merchantOsApiUrl: string;
  merchantApiKey: string;
  route: {
    method: string;
    path: string;
  };
  apiId?: string;
  apiProductId?: string;
  settlementModeOverride?: "same_chain" | "cross_chain";
  paywallAppName?: string;
  paywallTestnet?: boolean;
  autoRefreshMs?: number;
  supportedSourceNetworks?: Array<`${string}:${string}`>;
  sourceNetworkFilter?: "all" | "testnet_only" | "mainnet_only";
  maxRequirementOptions?: number;
  logPrefix?: string;
};

type RequirementPrice = {
  asset: string;
  amount: string;
  extra?: Record<string, unknown>;
};

type Requirement = {
  scheme: string;
  network: string;
  price: RequirementPrice;
  payTo: `0x${string}`;
  extra?: Record<string, unknown>;
};

type MerchantOsResolvedRequirement = {
  merchantId: string;
  accountId: string;
  settlementMode?: string;
  requirement: Requirement;
  requirements?: Requirement[];
  crossChain: null | {
    destinationNetwork: string;
    destinationAsset: string;
    destinationPayTo: `0x${string}`;
  };
  apiProduct: {
    apiName: string;
    description?: string | null;
  };
};

type RouteInfo = {
  routeKey: string;
  payTo: string;
  sourceNetworks: string[];
  crossChain: boolean;
  settlementMode: string;
};

export type MerchantOsPaymentGuard = {
  middleware: RequestHandler;
  routeMethod: string;
  routePath: string;
  refreshRequirements: () => Promise<RouteInfo>;
  getCurrentRouteInfo: () => RouteInfo | null;
  startAutoRefresh: () => void;
  stopAutoRefresh: () => void;
};

class LoggingFacilitatorClient extends HTTPFacilitatorClient {
  private readonly logPrefix: string;

  constructor({ url, logPrefix }: { url: string; logPrefix: string }) {
    super({ url });
    this.logPrefix = logPrefix;
  }

  async settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    console.log(`${this.logPrefix} settle`, {
      network: paymentRequirements.network,
      scheme: paymentRequirements.scheme,
    });
    return super.settle(paymentPayload, paymentRequirements);
  }

  async verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    console.log(`${this.logPrefix} verify`, {
      network: paymentRequirements.network,
      scheme: paymentRequirements.scheme,
    });
    return super.verify(paymentPayload, paymentRequirements);
  }
}

const normalizeMethod = (method: string) => {
  const value = String(method || "").trim().toUpperCase();
  return value || "GET";
};

const normalizePath = (path: string) => {
  const value = String(path || "").trim();
  if (!value) {
    throw new Error("route.path is required");
  }
  return value.startsWith("/") ? value : `/${value}`;
};

const normalizeSettlementMode = (mode: string) => {
  const value = String(mode || "").trim().toLowerCase();
  if (!SUPPORTED_SETTLEMENT_MODES.has(value)) {
    throw new Error("settlementModeOverride must be either 'same_chain' or 'cross_chain'");
  }
  return value as "same_chain" | "cross_chain";
};

const ensureRequired = (value: string, fieldName: string) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required`);
  }
  return trimmed;
};

const fetchFacilitatorSupportedNetworks = async (
  facilitatorUrl: string,
): Promise<Array<`${string}:${string}`>> => {
  try {
    const response = await fetch(`${facilitatorUrl}${FACILITATOR_SUPPORTED_ENDPOINT}`);
    if (!response.ok) {
      return [...DEFAULT_SUPPORTED_NETWORKS];
    }
    const body = (await response.json().catch(() => ({}))) as {
      kinds?: Array<{ network?: string; scheme?: string }>;
    };
    const networks = Array.isArray(body.kinds)
      ? body.kinds
          .filter(
            (kind): kind is { network: `${string}:${string}`; scheme: string } =>
              Boolean(kind?.network && kind?.scheme),
          )
          .filter((kind) => kind.scheme === "exact")
          .map((kind) => kind.network)
      : [];

    if (!networks.length) {
      return [...DEFAULT_SUPPORTED_NETWORKS];
    }
    return Array.from(new Set(networks));
  } catch {
    return [...DEFAULT_SUPPORTED_NETWORKS];
  }
};

type FacilitatorChainRecord = {
  network: `${string}:${string}`;
  isTestnet: boolean;
};

const fetchFacilitatorChains = async (
  facilitatorUrl: string,
): Promise<FacilitatorChainRecord[]> => {
  try {
    const response = await fetch(`${facilitatorUrl}${FACILITATOR_CHAINS_ENDPOINT}`);
    if (!response.ok) {
      return [];
    }
    const body = (await response.json().catch(() => ({}))) as {
      items?: Array<{ network?: string; isTestnet?: unknown; status?: unknown }>;
    };
    if (!Array.isArray(body.items)) {
      return [];
    }
    return body.items
      .filter(
        (item): item is { network: `${string}:${string}`; isTestnet?: unknown; status?: unknown } =>
          typeof item?.network === "string" && item.network.includes(":"),
      )
      .filter((item) => String(item.status || "active").toLowerCase() !== "paused")
      .map((item) => ({
        network: item.network,
        isTestnet: Boolean(item.isTestnet),
      }));
  } catch {
    return [];
  }
};

const clampMaxRequirementOptions = (value: number | undefined) => {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_REQUIREMENT_OPTIONS;
  }
  const normalized = Math.floor(Number(value));
  if (normalized <= 0) {
    return 1;
  }
  return normalized;
};

const sortRequirementOptions = (options: Requirement[]) => {
  const weightByNetwork = new Map(
    PREFERRED_REQUIREMENT_NETWORKS.map((network, index) => [network, index]),
  );
  return [...options].sort((left, right) => {
    const leftWeight = weightByNetwork.get(left.network as `${string}:${string}`);
    const rightWeight = weightByNetwork.get(right.network as `${string}:${string}`);
    if (leftWeight !== undefined && rightWeight !== undefined) {
      return leftWeight - rightWeight;
    }
    if (leftWeight !== undefined) {
      return -1;
    }
    if (rightWeight !== undefined) {
      return 1;
    }
    return left.network.localeCompare(right.network);
  });
};

export const createMerchantOsPaymentGuard = async (
  config: MerchantOsPaymentGuardConfig,
): Promise<MerchantOsPaymentGuard> => {
  const facilitatorUrl = ensureRequired(config.facilitatorUrl, "facilitatorUrl");
  const merchantOsApiUrl = ensureRequired(config.merchantOsApiUrl, "merchantOsApiUrl");
  const merchantApiKey = ensureRequired(config.merchantApiKey, "merchantApiKey");
  const routeMethod = normalizeMethod(config.route?.method || "GET");
  const routePath = normalizePath(config.route?.path || "");
  const apiId = String(config.apiId || "").trim();
  const apiProductId = String(config.apiProductId || "").trim();
  const settlementMode = config.settlementModeOverride
    ? normalizeSettlementMode(config.settlementModeOverride)
    : null;
  const logPrefix = config.logPrefix || "[railbridge-sdk]";
  const maxRequirementOptions = clampMaxRequirementOptions(config.maxRequirementOptions);
  const sourceNetworkFilter = config.sourceNetworkFilter || "all";

  const routes: Record<string, any> = {};
  let currentRouteInfo: RouteInfo | null = null;
  const fetchedSupportedNetworks =
    config.supportedSourceNetworks && config.supportedSourceNetworks.length
      ? config.supportedSourceNetworks
      : await fetchFacilitatorSupportedNetworks(facilitatorUrl);
  const facilitatorChains = await fetchFacilitatorChains(facilitatorUrl);
  const filteredSourceNetworkSet =
    sourceNetworkFilter === "all"
      ? null
      : new Set(
          facilitatorChains
            .filter((chain) =>
              sourceNetworkFilter === "testnet_only" ? chain.isTestnet : !chain.isTestnet,
            )
            .map((chain) => chain.network),
        );
  const supportedSourceNetworks =
    filteredSourceNetworkSet && filteredSourceNetworkSet.size
      ? fetchedSupportedNetworks.filter((network) => filteredSourceNetworkSet.has(network))
      : fetchedSupportedNetworks;
  if (filteredSourceNetworkSet && !filteredSourceNetworkSet.size) {
    console.warn(`${logPrefix} unable to enforce source network filter`, {
      sourceNetworkFilter,
      reason: "facilitator /chains metadata unavailable",
    });
  } else if (filteredSourceNetworkSet && supportedSourceNetworks.length !== fetchedSupportedNetworks.length) {
    console.info(`${logPrefix} source network filter applied`, {
      sourceNetworkFilter,
      before: fetchedSupportedNetworks.length,
      after: supportedSourceNetworks.length,
    });
  }
  const supportedSourceNetworkSet = new Set(supportedSourceNetworks);

  const facilitatorClient = new LoggingFacilitatorClient({
    url: facilitatorUrl,
    logPrefix,
  });

  const resourceServer = new x402ResourceServer(facilitatorClient);

  registerExactEvmScheme(resourceServer, {
    networks: supportedSourceNetworks,
  });

  const paywall = createPaywall()
    .withNetwork(evmPaywall)
    .withConfig({
      appName: config.paywallAppName || "RailBridge Merchant Integration",
      testnet: config.paywallTestnet ?? true,
    })
    .build();

  const routeKey = `${routeMethod} ${routePath}`;

  const fetchResolvedRequirement = async (): Promise<MerchantOsResolvedRequirement> => {
    const response = await fetch(`${merchantOsApiUrl}/v1/sdk/requirements/resolve`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-railbridge-api-key": merchantApiKey,
      },
      body: JSON.stringify({
        apiId: apiId || undefined,
        apiProductId: apiProductId || undefined,
        method: routeMethod,
        path: routePath,
        settlementModeOverride: settlementMode || undefined,
      }),
    });

    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    if (!response.ok) {
      throw new Error(
        `Merchant OS requirement resolve failed (${response.status}): ${body.error || body.message || "unknown error"}`,
      );
    }

    return body as MerchantOsResolvedRequirement;
  };

  const refreshRequirements = async (): Promise<RouteInfo> => {
    const resolved = await fetchResolvedRequirement();
    const requirementOptions =
      Array.isArray(resolved.requirements) && resolved.requirements.length
        ? resolved.requirements
        : [resolved.requirement];
    const supportedRequirements = requirementOptions.filter((requirement) =>
      supportedSourceNetworkSet.has(requirement.network as `${string}:${string}`),
    );

    if (!supportedRequirements.length) {
      const requestedNetworks = Array.from(
        new Set(requirementOptions.map((requirement) => requirement.network)),
      );
      throw new Error(
        `No supported source networks after filtering. Requested=${requestedNetworks.join(",")} Supported=${Array.from(
          supportedSourceNetworkSet,
        ).join(",")}`,
      );
    }

    const prioritizedRequirements = sortRequirementOptions(supportedRequirements);
    const truncatedRequirements = prioritizedRequirements.slice(0, maxRequirementOptions);
    if (truncatedRequirements.length < supportedRequirements.length) {
      console.warn(`${logPrefix} requirement options truncated`, {
        requested: supportedRequirements.length,
        served: truncatedRequirements.length,
        maxRequirementOptions,
      });
    }

    const nextRoute: Record<string, unknown> = {
      accepts: truncatedRequirements.map((requirement) => ({
        scheme: requirement.scheme,
        network: requirement.network,
        price: requirement.price,
        payTo: requirement.payTo,
        merchantId: resolved.merchantId,
        accountId: resolved.accountId,
        extra: requirement.extra,
      })),
      description:
        resolved.requirement.extra?.description ||
        resolved.apiProduct?.description ||
        resolved.apiProduct?.apiName ||
        "RailBridge protected endpoint",
      mimeType: "application/json",
    };

    if (resolved.crossChain) {
      nextRoute.extensions = {
        [CROSS_CHAIN]: declareCrossChainExtension({
          destinationNetwork: resolved.crossChain.destinationNetwork,
          destinationAsset: resolved.crossChain.destinationAsset,
          destinationPayTo: resolved.crossChain.destinationPayTo,
        }),
      };
    }

    Object.keys(routes).forEach((key) => delete routes[key]);
    routes[routeKey] = nextRoute;

    currentRouteInfo = {
      routeKey,
      payTo: resolved.requirement.payTo,
      sourceNetworks: truncatedRequirements.map((requirement) => requirement.network),
      crossChain: Boolean(resolved.crossChain),
      settlementMode: settlementMode || "auto",
    };

    console.log(`${logPrefix} route requirements refreshed`, currentRouteInfo);
    return currentRouteInfo;
  };

  await refreshRequirements();

  const middleware = paymentMiddleware(routes, resourceServer, undefined, paywall, true);

  let refreshTimer: NodeJS.Timeout | null = null;

  const startAutoRefresh = () => {
    if (refreshTimer) {
      return;
    }
    const everyMs = Math.max(10_000, Number(config.autoRefreshMs || 30_000));
    refreshTimer = setInterval(() => {
      refreshRequirements().catch((error) => {
        console.warn(`${logPrefix} route refresh failed`, {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, everyMs);
    refreshTimer.unref();
  };

  const stopAutoRefresh = () => {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  };

  return {
    middleware,
    routeMethod,
    routePath,
    refreshRequirements,
    getCurrentRouteInfo: () => currentRouteInfo,
    startAutoRefresh,
    stopAutoRefresh,
  };
};
