import express from "express";
import { loadFacilitatorEnv } from "./load-env.js";
import { createMerchantOsPaymentGuard } from "./services/merchantOsPaymentGuard.js";

loadFacilitatorEnv();

const RB_API_KEY = String(process.env.RB_API_KEY || "").trim();
const RB_API_ID = String(process.env.RB_API_ID || "").trim();
const RB_SETTLEMENT_MODE_OVERRIDE = String(process.env.RB_SETTLEMENT_MODE_OVERRIDE || "")
  .trim()
  .toLowerCase();
const RB_FACILITATOR_URL = String(
  process.env.RB_FACILITATOR_URL || "https://facilitator.testnet.railbridge.ai"
).trim();
const RB_MERCHANT_OS_API_URL = String(
  process.env.RB_MERCHANT_OS_API_URL || "https://api.testnet.railbridge.ai"
).trim();
const RB_MAX_PAYMENT_OPTIONS = Number.parseInt(process.env.RB_MAX_PAYMENT_OPTIONS || "32", 10);
const MERCHANT_PORT = Number.parseInt(process.env.PORT || "4021", 10);
const PROTECTED_ROUTE_METHOD = "GET";
const PROTECTED_ROUTE_PATH = "/api/premium";

const isHttpUrl = (value: string) => /^https?:\/\//.test(value);

if (!RB_API_KEY) {
  console.error("RB_API_KEY is required");
  process.exit(1);
}

if (!isHttpUrl(RB_FACILITATOR_URL)) {
  console.error("RB_FACILITATOR_URL must be a valid http(s) URL");
  process.exit(1);
}

if (!isHttpUrl(RB_MERCHANT_OS_API_URL)) {
  console.error("RB_MERCHANT_OS_API_URL must be a valid http(s) URL");
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
      timestamp: Date.now()
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
    facilitatorUrl: RB_FACILITATOR_URL,
    merchantOsApiUrl: RB_MERCHANT_OS_API_URL,
    merchantApiKey: RB_API_KEY,
    route: {
      method: PROTECTED_ROUTE_METHOD,
      path: PROTECTED_ROUTE_PATH
    },
    apiId: RB_API_ID || undefined,
    settlementModeOverride: RB_SETTLEMENT_MODE_OVERRIDE
      ? (RB_SETTLEMENT_MODE_OVERRIDE as "same_chain" | "cross_chain")
      : undefined,
    paywallAppName: "RailBridge Merchant OS Testnet Demo Merchant",
    paywallTestnet: true,
    sourceNetworkFilter: "testnet_only",
    autoRefreshMs: 30_000,
    maxRequirementOptions: Number.isFinite(RB_MAX_PAYMENT_OPTIONS)
      ? RB_MAX_PAYMENT_OPTIONS
      : 32,
    logPrefix: "[merchant-os-testnet-demo]"
  });

  app.use(paymentGuard.middleware);

  registerRouteHandler({
    method: paymentGuard.routeMethod,
    path: paymentGuard.routePath
  });

  app.post("/internal/reload-routes", async (_req, res) => {
    try {
      const routeInfo = await paymentGuard.refreshRequirements();
      return res.json({ success: true, routeInfo });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      route: `${paymentGuard.routeMethod} ${paymentGuard.routePath}`,
      requirements: paymentGuard.getCurrentRouteInfo()
    });
  });

  app.listen(MERCHANT_PORT, () => {
    console.log(`Merchant OS testnet demo merchant server listening at http://localhost:${MERCHANT_PORT}`);
    console.log(`Facilitator URL: ${RB_FACILITATOR_URL}`);
    console.log(`Merchant OS API URL: ${RB_MERCHANT_OS_API_URL}`);
    console.log(`Protected route: ${paymentGuard.routeMethod} ${paymentGuard.routePath}`);
    console.log(
      `Settlement mode override: ${
        RB_SETTLEMENT_MODE_OVERRIDE || "auto (use product settlement policy)"
      }`
    );
    console.log(
      `Max payment options per challenge: ${Number.isFinite(RB_MAX_PAYMENT_OPTIONS) ? RB_MAX_PAYMENT_OPTIONS : 32}`
    );
    console.log("Source network filter: testnet_only");
    console.log("Integration mode: external merchant via public RailBridge testnet URLs");
  });

  paymentGuard.startAutoRefresh();
};

start().catch((error) => {
  console.error("Failed to start merchant-os testnet demo merchant server", error);
  process.exit(1);
});
