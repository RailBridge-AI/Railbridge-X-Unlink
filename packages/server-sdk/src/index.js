import { createExpressWebhookHandler, verifyWebhook } from "./webhooks.js";

const ENVIRONMENT_DEFAULTS = {
  local: {
    merchantOsUrl: "http://localhost:4030",
    facilitatorUrl: "http://localhost:4022",
    paywallTestnet: true,
    sourceNetworkFilter: "all",
  },
  testnet: {
    merchantOsUrl: "https://api.testnet.railbridge.ai",
    facilitatorUrl: "https://facilitator.testnet.railbridge.ai",
    paywallTestnet: true,
    sourceNetworkFilter: "testnet_only",
  },
  live: {
    merchantOsUrl: "https://api.railbridge.xyz",
    facilitatorUrl: "https://facilitator.railbridge.xyz",
    paywallTestnet: false,
    sourceNetworkFilter: "all",
  },
};

const normalizeEnvironment = (value) => {
  const normalized = String(value || "testnet").trim().toLowerCase();
  if (normalized === "mainnet" || normalized === "production" || normalized === "prod") {
    return "live";
  }
  if (normalized === "dev") {
    return "local";
  }
  if (!["local", "testnet", "live"].includes(normalized)) {
    throw new Error("environment must be one of: local, testnet, live");
  }
  return normalized;
};

const normalizeMethod = (method) => {
  const value = String(method || "").trim().toUpperCase();
  return value || "GET";
};

const normalizePath = (path, fieldName = "path") => {
  const value = String(path || "").trim();
  if (!value) {
    throw new Error(`${fieldName} is required`);
  }
  return value.startsWith("/") ? value : `/${value}`;
};

const ensureNonEmpty = (value, fieldName) => {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`${fieldName} is required`);
  }
  return text;
};

const parseBoolean = (value, fieldName) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(`${fieldName} must be a boolean-like value`);
};

const parseOptionalFiniteNumber = (value, fieldName) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} must be a finite number`);
  }
  return parsed;
};

const resolveEnvironmentInput = (value, fieldName = "environment") => {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`${fieldName} is required`);
  }
  return normalizeEnvironment(text);
};

const readAdvanced = (config = {}) => {
  if (!config.advanced || typeof config.advanced !== "object") {
    return {};
  }
  return config.advanced;
};

const mergeDefaults = (config = {}) => {
  const advanced = readAdvanced(config);
  const environment = normalizeEnvironment(config.environment || "testnet");
  const defaults = ENVIRONMENT_DEFAULTS[environment];

  return {
    environment,
    apiKey: ensureNonEmpty(config.apiKey, "apiKey"),
    merchantOsUrl: String(
      advanced.merchantOsUrl || config.merchantOsUrl || defaults.merchantOsUrl,
    ).trim(),
    facilitatorUrl: String(
      advanced.facilitatorUrl || config.facilitatorUrl || defaults.facilitatorUrl,
    ).trim(),
    paywallTestnet:
      typeof advanced.paywallTestnet === "boolean"
        ? advanced.paywallTestnet
        : typeof config.paywallTestnet === "boolean"
          ? config.paywallTestnet
        : defaults.paywallTestnet,
    sourceNetworkFilter:
      advanced.sourceNetworkFilter || config.sourceNetworkFilter || defaults.sourceNetworkFilter,
    maxRequirementOptions: advanced.maxRequirementOptions ?? config.maxRequirementOptions,
    autoRefreshMs: advanced.autoRefreshMs ?? config.autoRefreshMs,
    logPrefix: advanced.logPrefix || config.logPrefix || "[railbridge-sdk]",
    paywallAppName:
      advanced.paywallAppName || config.paywallAppName || "RailBridge Merchant Integration",
    supportedSourceNetworks: advanced.supportedSourceNetworks || config.supportedSourceNetworks,
    logger: advanced.logger || config.logger || console,
    logLevel: advanced.logLevel || config.logLevel || "warn",
  };
};

const mountProtectedRoute = (app, method, path, middleware, handlers) => {
  if (!app || (typeof app !== "object" && typeof app !== "function")) {
    throw new Error("protectExpress(...) requires an Express app instance");
  }

  const normalizedMethod = String(method || "GET").trim().toLowerCase();
  const normalizedPath = normalizePath(path, "routeConfig.path");
  const normalizedHandlers = handlers.filter(Boolean);

  if (!normalizedHandlers.length) {
    throw new Error("protectExpress(...) requires at least one route handler");
  }

  if (typeof app[normalizedMethod] === "function") {
    app[normalizedMethod](normalizedPath, middleware, ...normalizedHandlers);
    return;
  }

  if (typeof app.all === "function") {
    app.all(normalizedPath, middleware, ...normalizedHandlers);
    return;
  }

  throw new Error(`protectExpress(...) could not find app.${normalizedMethod}(...) or app.all(...)`);
};

const resolveOnboardingStatus = async ({ merchantOsUrl, token }) => {
  const response = await fetch(`${merchantOsUrl.replace(/\/$/, "")}/v1/onboarding/checklist`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `onboarding status failed (${response.status})`);
  }
  return payload;
};

const resolveRequirements = async ({
  merchantOsUrl,
  apiKey,
  apiId,
  apiProductId,
  method = "GET",
  path,
  settlementModeOverride,
}) => {
  const response = await fetch(`${merchantOsUrl.replace(/\/$/, "")}/v1/sdk/requirements/resolve`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-railbridge-api-key": apiKey,
    },
    body: JSON.stringify({
      apiId,
      apiProductId,
      method: String(method || "GET").trim().toUpperCase(),
      path,
      settlementModeOverride,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `resolve requirements failed (${response.status})`);
  }
  return payload;
};

export const createRailbridge = (config = {}) => {
  const base = mergeDefaults(config);
  const client = {
    environment: base.environment,
    merchantOsUrl: base.merchantOsUrl,
    facilitatorUrl: base.facilitatorUrl,

    async resolveRequirements(input = {}) {
      const method = input.method || "GET";
      const path = String(input.path || "").trim();
      if (!path) {
        throw new Error("path is required");
      }

      return resolveRequirements({
        merchantOsUrl: base.merchantOsUrl,
        apiKey: base.apiKey,
        apiId: input.apiId,
        apiProductId: input.apiProductId,
        method,
        path,
        settlementModeOverride: input.settlementModeOverride,
      });
    },

    async getOnboardingStatus(input = {}) {
      const token = ensureNonEmpty(input.token, "token");
      const merchantOsUrl = String(input.merchantOsUrl || base.merchantOsUrl).trim();
      return resolveOnboardingStatus({ merchantOsUrl, token });
    },

    async protect(routeConfig = {}) {
      const advanced = readAdvanced(routeConfig);
      const method = normalizeMethod(routeConfig.method || "GET");
      const path = normalizePath(routeConfig.path, "routeConfig.path");

      const guard = await createRailbridgePaymentGuard({
        facilitatorUrl: base.facilitatorUrl,
        merchantOsApiUrl: base.merchantOsUrl,
        merchantApiKey: base.apiKey,
        route: {
          method,
          path,
        },
        apiId: routeConfig.apiId,
        apiProductId: routeConfig.apiProductId,
        settlementModeOverride: routeConfig.settlementModeOverride,
        paywallAppName: advanced.paywallAppName || routeConfig.paywallAppName || base.paywallAppName,
        paywallTestnet:
          typeof advanced.paywallTestnet === "boolean"
            ? advanced.paywallTestnet
            : typeof routeConfig.paywallTestnet === "boolean"
              ? routeConfig.paywallTestnet
            : base.paywallTestnet,
        autoRefreshMs:
          Number.isFinite(advanced.autoRefreshMs)
            ? advanced.autoRefreshMs
            : Number.isFinite(routeConfig.autoRefreshMs)
              ? routeConfig.autoRefreshMs
              : base.autoRefreshMs,
        supportedSourceNetworks:
          advanced.supportedSourceNetworks ||
          routeConfig.supportedSourceNetworks ||
          base.supportedSourceNetworks,
        sourceNetworkFilter:
          advanced.sourceNetworkFilter ||
          routeConfig.sourceNetworkFilter ||
          base.sourceNetworkFilter,
        maxRequirementOptions:
          Number.isFinite(advanced.maxRequirementOptions)
            ? advanced.maxRequirementOptions
            : Number.isFinite(routeConfig.maxRequirementOptions)
              ? routeConfig.maxRequirementOptions
            : base.maxRequirementOptions,
        logPrefix: advanced.logPrefix || routeConfig.logPrefix || base.logPrefix,
        logger: advanced.logger || routeConfig.logger || base.logger,
        logLevel: advanced.logLevel || routeConfig.logLevel || base.logLevel,
      });

      const middleware = guard.middleware;
      middleware.routeMethod = guard.routeMethod;
      middleware.routePath = guard.routePath;
      middleware.refreshRequirements = guard.refreshRequirements;
      middleware.getCurrentRouteInfo = guard.getCurrentRouteInfo;
      middleware.startAutoRefresh = guard.startAutoRefresh;
      middleware.stopAutoRefresh = guard.stopAutoRefresh;

      return middleware;
    },

    async protectExpress(app, routeConfig = {}, ...handlers) {
      const middleware = await client.protect(routeConfig);
      const method = middleware.routeMethod || normalizeMethod(routeConfig.method || "GET");
      const path = middleware.routePath || normalizePath(routeConfig.path, "routeConfig.path");
      mountProtectedRoute(app, method, path, middleware, handlers);
      return middleware;
    },

    webhooks: {
      verify: verifyWebhook,
      express: createExpressWebhookHandler,
    },
  };

  return client;
};

export const createRailbridgeFromEnv = (env = process.env, overrides = {}) => {
  if (!env || typeof env !== "object") {
    throw new Error("env must be an object");
  }

  const environment = resolveEnvironmentInput(
    overrides.environment ?? env.RB_ENV ?? env.RAILBRIDGE_ENV,
    "RB_ENV or RAILBRIDGE_ENV",
  );

  return createRailbridge({
    ...overrides,
    apiKey: overrides.apiKey ?? env.RB_API_KEY,
    environment,
    advanced: {
      ...(overrides.advanced || {}),
      merchantOsUrl: overrides.advanced?.merchantOsUrl ?? overrides.merchantOsUrl ?? env.RB_MERCHANT_OS_URL,
      facilitatorUrl:
        overrides.advanced?.facilitatorUrl ?? overrides.facilitatorUrl ?? env.RB_FACILITATOR_URL,
      paywallTestnet:
        overrides.advanced?.paywallTestnet ??
        overrides.paywallTestnet ??
        parseBoolean(env.RB_PAYWALL_TESTNET, "RB_PAYWALL_TESTNET"),
      sourceNetworkFilter:
        overrides.advanced?.sourceNetworkFilter ??
        overrides.sourceNetworkFilter ??
        env.RB_SOURCE_NETWORK_FILTER,
      maxRequirementOptions:
        overrides.advanced?.maxRequirementOptions ??
        overrides.maxRequirementOptions ??
        parseOptionalFiniteNumber(env.RB_MAX_REQUIREMENT_OPTIONS, "RB_MAX_REQUIREMENT_OPTIONS"),
      autoRefreshMs:
        overrides.advanced?.autoRefreshMs ??
        overrides.autoRefreshMs ??
        parseOptionalFiniteNumber(env.RB_AUTO_REFRESH_MS, "RB_AUTO_REFRESH_MS"),
      logPrefix: overrides.advanced?.logPrefix ?? overrides.logPrefix ?? env.RB_LOG_PREFIX,
      paywallAppName:
        overrides.advanced?.paywallAppName ?? overrides.paywallAppName ?? env.RB_PAYWALL_APP_NAME,
      logLevel: overrides.advanced?.logLevel ?? overrides.logLevel ?? env.RB_LOG_LEVEL,
      logger: overrides.advanced?.logger ?? overrides.logger,
    },
  });
};

export const getOnboardingStatus = async ({ merchantOsUrl, token }) => {
  return resolveOnboardingStatus({
    merchantOsUrl: ensureNonEmpty(merchantOsUrl, "merchantOsUrl"),
    token: ensureNonEmpty(token, "token"),
  });
};

export const createRailbridgePaymentGuard = async (config) => {
  const module = await import("./paymentGuard.js");
  return module.createRailbridgePaymentGuard(config);
};

export { createExpressWebhookHandler, verifyWebhook };
