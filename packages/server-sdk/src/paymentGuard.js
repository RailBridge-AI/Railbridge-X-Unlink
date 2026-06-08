import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer } from "@x402/core/server";
import { HTTPFacilitatorClient } from "@x402/core/http";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { createPaywall } from "@x402/paywall";
import { evmPaywall } from "@x402/paywall/evm";
import { CROSS_CHAIN, declareCrossChainExtension } from "./crossChain.js";

const DEFAULT_SUPPORTED_NETWORKS = [
  "eip155:421614",
  "eip155:5042002",
  "eip155:84532",
  "eip155:11155111",
  "eip155:8453",
  "eip155:137",
  "eip155:1",
];

const DEFAULT_MAX_REQUIREMENT_OPTIONS = 8;
const LOG_LEVEL_PRIORITY = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};
const PREFERRED_REQUIREMENT_NETWORKS = [
  "eip155:84532",
  "eip155:421614",
  "eip155:11155111",
  "eip155:5042002",
  "eip155:8453",
  "eip155:42161",
  "eip155:10",
  "eip155:1",
  "eip155:137",
];

const SUPPORTED_SETTLEMENT_MODES = new Set(["same_chain", "cross_chain"]);
const FACILITATOR_SUPPORTED_ENDPOINT = "/supported";
const FACILITATOR_CHAINS_ENDPOINT = "/chains";
const DEFAULT_FETCH_TIMEOUT_MS = 8000;

const isValidPayTo = (value) =>
  typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value.trim());

const isValidNetwork = (value) =>
  typeof value === "string" && /^[a-z0-9]+:[a-zA-Z0-9]+$/.test(value.trim());

const isValidPrice = (value) => {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (typeof value.asset !== "string" || !value.asset.trim()) {
    return false;
  }
  if (typeof value.amount !== "string" || !/^\d+(\.\d+)?$/.test(value.amount.trim())) {
    return false;
  }
  return Number(value.amount) > 0;
};

const isValidRequirement = (value) =>
  value?.scheme === "exact" &&
  isValidNetwork(value.network) &&
  isValidPayTo(value.payTo) &&
  isValidPrice(value.price);

class LoggingFacilitatorClient extends HTTPFacilitatorClient {
  constructor({ url, sdkLogger }) {
    super({ url });
    this.sdkLogger = sdkLogger;
  }

  async settle(paymentPayload, paymentRequirements) {
    this.sdkLogger.debug("settle", {
      network: paymentRequirements.network,
      scheme: paymentRequirements.scheme,
    });
    return super.settle(paymentPayload, paymentRequirements);
  }

  async verify(paymentPayload, paymentRequirements) {
    this.sdkLogger.debug("verify", {
      network: paymentRequirements.network,
      scheme: paymentRequirements.scheme,
    });
    return super.verify(paymentPayload, paymentRequirements);
  }
}

const normalizeMethod = (method) => {
  const value = String(method || "").trim().toUpperCase();
  return value || "GET";
};

const normalizePath = (path) => {
  const value = String(path || "").trim();
  if (!value) {
    throw new Error("route.path is required");
  }
  return value.startsWith("/") ? value : `/${value}`;
};

const normalizeRequestPath = (path) => {
  const value = String(path || "").trim();
  if (!value) {
    return "/";
  }
  const withoutQuery = value.split("?")[0] || "/";
  return withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
};

const normalizeSettlementMode = (mode) => {
  const value = String(mode || "").trim().toLowerCase();
  if (!SUPPORTED_SETTLEMENT_MODES.has(value)) {
    throw new Error("settlementModeOverride must be either 'same_chain' or 'cross_chain'");
  }
  return value;
};

const ensureRequired = (value, fieldName) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required`);
  }
  return trimmed;
};

const createSdkLogger = ({ logger = console, logLevel = "warn", logPrefix = "[railbridge-sdk]" }) => {
  const threshold = LOG_LEVEL_PRIORITY[logLevel] ?? LOG_LEVEL_PRIORITY.warn;
  const resolveMethod = (level) => {
    const fn = logger?.[level];
    return typeof fn === "function" ? fn.bind(logger) : null;
  };

  const emit = (level, message, metadata) => {
    if ((LOG_LEVEL_PRIORITY[level] ?? LOG_LEVEL_PRIORITY.info) > threshold) {
      return;
    }

    const fn = resolveMethod(level);
    if (!fn) {
      return;
    }

    if (metadata === undefined) {
      fn(`${logPrefix} ${message}`);
      return;
    }

    fn(`${logPrefix} ${message}`, metadata);
  };

  return {
    debug(message, metadata) {
      emit("debug", message, metadata);
    },
    info(message, metadata) {
      emit("info", message, metadata);
    },
    warn(message, metadata) {
      emit("warn", message, metadata);
    },
    error(message, metadata) {
      emit("error", message, metadata);
    },
  };
};

const fetchWithTimeout = async (url, init = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

const fetchFacilitatorSupportedNetworks = async (facilitatorUrl) => {
  try {
    const response = await fetchWithTimeout(`${facilitatorUrl}${FACILITATOR_SUPPORTED_ENDPOINT}`);
    if (!response.ok) {
      return [...DEFAULT_SUPPORTED_NETWORKS];
    }

    const body = await response.json().catch(() => ({}));
    const networks = Array.isArray(body.kinds)
      ? body.kinds
          .filter((kind) => Boolean(kind?.network && kind?.scheme))
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

const fetchFacilitatorChains = async (facilitatorUrl) => {
  try {
    const response = await fetchWithTimeout(`${facilitatorUrl}${FACILITATOR_CHAINS_ENDPOINT}`);
    if (!response.ok) {
      return [];
    }
    const body = await response.json().catch(() => ({}));
    if (!Array.isArray(body.items)) {
      return [];
    }

    return body.items
      .filter((item) => typeof item?.network === "string" && item.network.includes(":"))
      .filter((item) => String(item.status || "active").toLowerCase() !== "paused")
      .map((item) => ({
        network: item.network,
        isTestnet: Boolean(item.isTestnet),
      }));
  } catch {
    return [];
  }
};

const clampMaxRequirementOptions = (value) => {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_REQUIREMENT_OPTIONS;
  }
  const normalized = Math.floor(Number(value));
  if (normalized <= 0) {
    return 1;
  }
  return normalized;
};

const sortRequirementOptions = (options) => {
  const weightByNetwork = new Map(
    PREFERRED_REQUIREMENT_NETWORKS.map((network, index) => [network, index]),
  );

  return [...options].sort((left, right) => {
    const leftWeight = weightByNetwork.get(left.network);
    const rightWeight = weightByNetwork.get(right.network);

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

export const createRailbridgePaymentGuard = async (config) => {
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
  const sdkLogger = createSdkLogger({
    logger: config.logger,
    logLevel: config.logLevel,
    logPrefix,
  });

  const routes = {};
  let currentRouteInfo = null;
  let refreshInFlight = null;
  let refreshTimer = null;
  let lastResolvedSignature = "";

  const fetchedSupportedNetworks =
    Array.isArray(config.supportedSourceNetworks) && config.supportedSourceNetworks.length
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
    throw new Error(
      `${logPrefix} unable to enforce source network filter: facilitator /chains metadata unavailable`,
    );
  }

  if (!supportedSourceNetworks.length) {
    throw new Error(`${logPrefix} no supported source networks available after initialization`);
  }

  const supportedSourceNetworkSet = new Set(supportedSourceNetworks);
  const facilitatorClient = new LoggingFacilitatorClient({
    url: facilitatorUrl,
    sdkLogger,
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

  const fetchResolvedRequirement = async () => {
    const response = await fetchWithTimeout(
      `${merchantOsApiUrl.replace(/\/$/, "")}/v1/sdk/requirements/resolve`,
      {
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
      },
      DEFAULT_FETCH_TIMEOUT_MS,
    );

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        `Merchant OS requirement resolve failed (${response.status}): ${body.error || body.message || "unknown error"}`,
      );
    }

    return body;
  };

  const refreshRequirementsInternal = async ({ reason = "manual", continueOnError = false } = {}) => {
    try {
      const resolved = await fetchResolvedRequirement();
      const requirementOptions =
        Array.isArray(resolved.requirements) && resolved.requirements.length
          ? resolved.requirements
          : [resolved.requirement];

      const invalidRequirement = requirementOptions.find((requirement) => !isValidRequirement(requirement));
      if (invalidRequirement) {
        throw new Error("Merchant OS returned invalid requirement payload");
      }

      const supportedRequirements = requirementOptions.filter((requirement) =>
        supportedSourceNetworkSet.has(requirement.network),
      );

      if (!supportedRequirements.length) {
        const requestedNetworks = Array.from(new Set(requirementOptions.map((r) => r.network)));
        throw new Error(
          `No supported source networks after filtering. Requested=${requestedNetworks.join(",")} Supported=${Array.from(
            supportedSourceNetworkSet,
          ).join(",")}`,
        );
      }

      const prioritizedRequirements = sortRequirementOptions(supportedRequirements);
      const truncatedRequirements = prioritizedRequirements.slice(0, maxRequirementOptions);

      const nextRoute = {
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
          resolved.requirement?.extra?.description ||
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

      routes[routeKey] = nextRoute;

      currentRouteInfo = {
        routeKey,
        payTo: resolved.requirement.payTo,
        sourceNetworks: truncatedRequirements.map((requirement) => requirement.network),
        crossChain: Boolean(resolved.crossChain),
        settlementMode: resolved.settlementMode || settlementMode || "auto",
      };

      const nextSignature = JSON.stringify({
        payTo: currentRouteInfo.payTo,
        sourceNetworks: currentRouteInfo.sourceNetworks,
        crossChain: currentRouteInfo.crossChain,
        settlementMode: currentRouteInfo.settlementMode,
        accepts: truncatedRequirements.map((requirement) => ({
          scheme: requirement.scheme,
          network: requirement.network,
          payTo: requirement.payTo,
          asset: requirement.price.asset,
          amount: requirement.price.amount,
        })),
        extension: resolved.crossChain || null,
      });

      if (nextSignature !== lastResolvedSignature) {
        lastResolvedSignature = nextSignature;
        sdkLogger.info("route requirements refreshed", {
          ...currentRouteInfo,
          reason,
        });
      }

      return currentRouteInfo;
    } catch (error) {
      if (continueOnError && currentRouteInfo) {
        sdkLogger.warn("route refresh failed, continuing with cached requirements", {
          reason,
          error: error instanceof Error ? error.message : String(error),
        });
        return currentRouteInfo;
      }
      throw error;
    }
  };

  const refreshRequirements = () => {
    if (!refreshInFlight) {
      refreshInFlight = refreshRequirementsInternal({ reason: "manual" }).finally(() => {
        refreshInFlight = null;
      });
    }
    return refreshInFlight;
  };

  const refreshForProtectedRequest = () => {
    if (!refreshInFlight) {
      refreshInFlight = refreshRequirementsInternal({
        reason: "request",
        continueOnError: false,
      }).finally(() => {
        refreshInFlight = null;
      });
    }
    return refreshInFlight;
  };

  await refreshRequirementsInternal({ reason: "startup" });

  const baseMiddleware = paymentMiddleware(routes, resourceServer, undefined, paywall, true);

  const shouldRefreshForRequest = (req) =>
    normalizeMethod(req.method || "GET") === routeMethod &&
    normalizeRequestPath(req.path || req.originalUrl || req.url || "") === routePath;

  const middleware = (req, res, next) => {
    if (!shouldRefreshForRequest(req)) {
      return baseMiddleware(req, res, next);
    }

    void refreshForProtectedRequest()
      .then(() => {
        baseMiddleware(req, res, next);
      })
      .catch((error) => {
        next(error);
      });
  };

  const startAutoRefresh = () => {
    if (refreshTimer) {
      return;
    }
    const everyMs = Math.max(10_000, Number(config.autoRefreshMs || 30_000));
    refreshTimer = setInterval(() => {
      if (!refreshInFlight) {
        refreshInFlight = refreshRequirementsInternal({
          reason: "interval",
          continueOnError: true,
        }).finally(() => {
          refreshInFlight = null;
        });
      }
    }, everyMs);

    if (typeof refreshTimer.unref === "function") {
      refreshTimer.unref();
    }
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
