type RequestHandler = (...args: any[]) => any;
type ExpressLikeApp = Record<string, any>;

export type RailbridgeEnvironment = "local" | "testnet" | "live" | "mainnet" | "production" | "prod";
export type RailbridgeLogLevel = "silent" | "error" | "warn" | "info" | "debug";

export type RailbridgeLogger = {
  debug?: (...args: any[]) => void;
  info?: (...args: any[]) => void;
  warn?: (...args: any[]) => void;
  error?: (...args: any[]) => void;
};

export type RailbridgeAdvancedConfig = {
  merchantOsUrl?: string;
  facilitatorUrl?: string;
  sourceNetworkFilter?: "all" | "testnet_only" | "mainnet_only";
  maxRequirementOptions?: number;
  autoRefreshMs?: number;
  logPrefix?: string;
  supportedSourceNetworks?: string[];
  logger?: RailbridgeLogger;
  logLevel?: RailbridgeLogLevel;
};

export type RailbridgeBaseConfig = {
  apiKey: string;
  environment?: RailbridgeEnvironment;
  advanced?: RailbridgeAdvancedConfig;
} & Partial<RailbridgeAdvancedConfig>;

export type RailbridgeFromEnvOverrides = Partial<RailbridgeBaseConfig>;

export type RailbridgeProtectConfig = {
  method?: string;
  path: string;
  apiId?: string;
  apiProductId?: string;
  settlementModeOverride?: "same_chain" | "cross_chain";
  advanced?: RailbridgeAdvancedConfig;
} & Partial<RailbridgeAdvancedConfig>;

export type RailbridgeGuardMiddleware = RequestHandler & {
  routeMethod?: string;
  routePath?: string;
  refreshRequirements?: () => Promise<unknown>;
  getCurrentRouteInfo?: () => unknown;
  startAutoRefresh?: () => void;
  stopAutoRefresh?: () => void;
};

export type ResolveRequirementsInput = {
  apiId?: string;
  apiProductId?: string;
  method?: string;
  path: string;
  settlementModeOverride?: "same_chain" | "cross_chain";
};

export type GetOnboardingStatusInput = {
  merchantOsUrl?: string;
  token: string;
};

export type WebhookVerifyInput = {
  secret: string;
  timestamp: string;
  payload: string | Record<string, unknown>;
  signature: string;
};

export type ExpressWebhookHandlerInput = {
  secret?: string;
  requireSignature?: boolean;
  onEvent?: (event: any, context: { headers: Record<string, unknown>; eventType: string | null; eventId: string | null }) => Promise<void> | void;
};

export type RailbridgeClient = {
  environment: "local" | "testnet" | "live";
  merchantOsUrl: string;
  facilitatorUrl: string;
  resolveRequirements: (input: ResolveRequirementsInput) => Promise<any>;
  getOnboardingStatus: (input: GetOnboardingStatusInput) => Promise<any>;
  protect: (routeConfig: RailbridgeProtectConfig) => Promise<RailbridgeGuardMiddleware>;
  protectExpress: (
    app: ExpressLikeApp,
    routeConfig: RailbridgeProtectConfig,
    ...handlers: RequestHandler[]
  ) => Promise<RailbridgeGuardMiddleware>;
  webhooks: {
    verify: (input: WebhookVerifyInput) => boolean;
    express: (input?: ExpressWebhookHandlerInput) => RequestHandler;
  };
};

export function createRailbridge(config: RailbridgeBaseConfig): RailbridgeClient;
export function createRailbridgeFromEnv(
  env?: Record<string, string | undefined>,
  overrides?: RailbridgeFromEnvOverrides,
): RailbridgeClient;
export function getOnboardingStatus(input: {
  merchantOsUrl: string;
  token: string;
}): Promise<any>;

export function createRailbridgePaymentGuard(config: any): Promise<any>;
export function createExpressWebhookHandler(input?: ExpressWebhookHandlerInput): RequestHandler;
export function verifyWebhook(input: WebhookVerifyInput): boolean;
