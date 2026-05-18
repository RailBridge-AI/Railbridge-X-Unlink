import express from "express";
import { loadFacilitatorEnv } from "./load-env.js";
import { createMerchantOsPaymentGuard } from "./services/merchantOsPaymentGuard.js";

loadFacilitatorEnv();

const RB_ENV = String(process.env.RB_ENV || "sandbox")
  .trim()
  .toLowerCase();
const RB_API_KEY = String(process.env.RB_API_KEY || process.env.MERCHANT_OS_API_KEY || "").trim();
const RB_API_ID = String(process.env.RB_API_ID || process.env.MERCHANT_OS_API_ID || "").trim();
const RB_SETTLEMENT_MODE_OVERRIDE = String(process.env.RB_SETTLEMENT_MODE_OVERRIDE || "")
  .trim()
  .toLowerCase();
const RB_MAX_PAYMENT_OPTIONS = Number.parseInt(process.env.RB_MAX_PAYMENT_OPTIONS || "8", 10);
const MERCHANT_PORT = Number.parseInt(process.env.PORT || "4021", 10);
const PROTECTED_ROUTE_METHOD = "GET";
const PROTECTED_ROUTE_PATH = "/api/premium";

const PLATFORM_BY_ENV = {
  sandbox: {
    facilitatorUrl: "http://localhost:4022",
    merchantOsApiUrl: "http://localhost:4030",
    paywallTestnet: true,
  },
  live: {
    facilitatorUrl: "https://facilitator.railbridge.xyz",
    merchantOsApiUrl: "https://api.railbridge.xyz",
    paywallTestnet: false,
  },
} as const;

const platform = PLATFORM_BY_ENV[RB_ENV as keyof typeof PLATFORM_BY_ENV] || PLATFORM_BY_ENV.sandbox;

if (!RB_API_KEY) {
  console.error("RB_API_KEY is required");
  process.exit(1);
}

if (
  RB_SETTLEMENT_MODE_OVERRIDE &&
  RB_SETTLEMENT_MODE_OVERRIDE !== "same_chain" &&
  RB_SETTLEMENT_MODE_OVERRIDE !== "cross_chain"
) {
  console.error("RB_SETTLEMENT_MODE_OVERRIDE must be either 'same_chain' or 'cross_chain'");
  process.exit(1);
}

const app = express();
app.use(express.json());

const registerRouteHandler = ({ method, path }: { method: string; path: string }) => {
  const handler = (_req: express.Request, res: express.Response) => {
    res.json({
      message: "You successfully paid for this RailBridge-protected endpoint.",
      route: `${method} ${path}`,
      timestamp: Date.now(),
    });
  };

  const normalizedMethod = method.toLowerCase();
  if (typeof (app as any)[normalizedMethod] === "function") {
    (app as any)[normalizedMethod](path, handler);
    return;
  }

  app.all(path, handler);
};

const start = async () => {
  const paymentGuard = await createMerchantOsPaymentGuard({
    facilitatorUrl: platform.facilitatorUrl,
    merchantOsApiUrl: platform.merchantOsApiUrl,
    merchantApiKey: RB_API_KEY,
    route: {
      method: PROTECTED_ROUTE_METHOD,
      path: PROTECTED_ROUTE_PATH,
    },
    apiId: RB_API_ID || undefined,
    settlementModeOverride: RB_SETTLEMENT_MODE_OVERRIDE
      ? (RB_SETTLEMENT_MODE_OVERRIDE as "same_chain" | "cross_chain")
      : undefined,
    paywallAppName: "RailBridge Merchant OS Demo Merchant",
    paywallTestnet: platform.paywallTestnet,
    autoRefreshMs: 30_000,
    maxRequirementOptions: Number.isFinite(RB_MAX_PAYMENT_OPTIONS) ? RB_MAX_PAYMENT_OPTIONS : 8,
    logPrefix: "[merchant-os-demo]",
  });

  // Merchant app only mounts one middleware. x402 verify/settle remains abstracted behind this.
  app.use(paymentGuard.middleware);

  registerRouteHandler({
    method: paymentGuard.routeMethod,
    path: paymentGuard.routePath,
  });

  app.post("/internal/reload-routes", async (_req, res) => {
    try {
      const routeInfo = await paymentGuard.refreshRequirements();
      return res.json({ success: true, routeInfo });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      route: `${paymentGuard.routeMethod} ${paymentGuard.routePath}`,
      requirements: paymentGuard.getCurrentRouteInfo(),
    });
  });

  app.listen(MERCHANT_PORT, () => {
    console.log(`Merchant OS demo merchant server listening at http://localhost:${MERCHANT_PORT}`);
    console.log(`Environment: ${RB_ENV}`);
    console.log(`Facilitator URL: ${platform.facilitatorUrl}`);
    console.log(`Merchant OS API URL: ${platform.merchantOsApiUrl}`);
    console.log(`Protected route: ${paymentGuard.routeMethod} ${paymentGuard.routePath}`);
    console.log(
      `Settlement mode override: ${
        RB_SETTLEMENT_MODE_OVERRIDE || "auto (use product settlement policy)"
      }`
    );
    console.log(`Max payment options per challenge: ${Number.isFinite(RB_MAX_PAYMENT_OPTIONS) ? RB_MAX_PAYMENT_OPTIONS : 8}`);
    console.log("Integration mode: abstracted (merchant does not directly call facilitator verify/settle)");
  });

  paymentGuard.startAutoRefresh();
};

start().catch((error) => {
  console.error("Failed to start merchant-os demo merchant server", error);
  process.exit(1);
});
