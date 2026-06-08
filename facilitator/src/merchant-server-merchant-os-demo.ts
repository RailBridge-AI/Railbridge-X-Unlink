import express from "express";
import { loadFacilitatorEnv } from "./load-env.js";
import { createRailbridgeFromEnv } from "@railbridgeai/merchant-sdk";

loadFacilitatorEnv();

const RB_ENV = String(process.env.RB_ENV || "local")
  .trim()
  .toLowerCase();
const SDK_ENV: "local" | "testnet" | "live" =
  RB_ENV === "sandbox"
    ? "local"
    : RB_ENV === "testnet"
      ? "testnet"
      : RB_ENV === "live"
        ? "live"
        : "local";
const RB_API_KEY = String(process.env.RB_API_KEY || "").trim();
const RB_API_ID = String(process.env.RB_API_ID || "").trim();
const RB_SETTLEMENT_MODE_OVERRIDE = String(process.env.RB_SETTLEMENT_MODE_OVERRIDE || "")
  .trim()
  .toLowerCase();
const MERCHANT_PORT = Number.parseInt(process.env.PORT || "4021", 10);
const PROTECTED_ROUTE_METHOD = "GET";
const PROTECTED_ROUTE_PATH = "/api/premium";
const SANDBOX_DEFAULT_MAX_PAYMENT_OPTIONS = 32;
const LIVE_DEFAULT_MAX_PAYMENT_OPTIONS = 8;

const defaultMaxPaymentOptions =
  RB_ENV === "live" ? LIVE_DEFAULT_MAX_PAYMENT_OPTIONS : SANDBOX_DEFAULT_MAX_PAYMENT_OPTIONS;
const RB_MAX_REQUIREMENT_OPTIONS = Number.parseInt(
  process.env.RB_MAX_REQUIREMENT_OPTIONS ||
    process.env.RB_MAX_PAYMENT_OPTIONS ||
    String(defaultMaxPaymentOptions),
  10,
);

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

const start = async () => {
  const rb = createRailbridgeFromEnv(process.env, {
    apiKey: RB_API_KEY,
    environment: SDK_ENV,
    maxRequirementOptions: Number.isFinite(RB_MAX_REQUIREMENT_OPTIONS)
      ? RB_MAX_REQUIREMENT_OPTIONS
      : defaultMaxPaymentOptions,
    logPrefix: "[merchant-os-demo]",
    paywallAppName: "RailBridge Merchant OS Demo Merchant",
  });

  const paymentGuard = await rb.protectExpress(
    app,
    {
      method: PROTECTED_ROUTE_METHOD,
      path: PROTECTED_ROUTE_PATH,
      apiId: RB_API_ID || undefined,
      settlementModeOverride: RB_SETTLEMENT_MODE_OVERRIDE
        ? (RB_SETTLEMENT_MODE_OVERRIDE as "same_chain" | "cross_chain")
        : undefined,
      autoRefreshMs: 30_000,
      maxRequirementOptions: Number.isFinite(RB_MAX_REQUIREMENT_OPTIONS)
        ? RB_MAX_REQUIREMENT_OPTIONS
        : defaultMaxPaymentOptions,
      logPrefix: "[merchant-os-demo]",
    },
    (_req: express.Request, res: express.Response) => {
      /*
      // Example merchant business logic (replace with your real implementation):
      const customerId = _req.header("x-customer-id");
      const hasEntitlement = await entitlementService.canAccessPremiumApi(customerId);
      if (!hasEntitlement) {
        return res.status(403).json({ error: "premium entitlement required" });
      }

      const report = await premiumReportService.generate({
        customerId,
        requestedAt: Date.now(),
      });

      await analyticsService.trackPremiumApiUsage({
        customerId,
        route: PROTECTED_ROUTE_PATH,
        paid: true,
      });

      return res.json(report);
      */

      res.json({
        message: "You successfully paid for this RailBridge-protected endpoint.",
        route: `${PROTECTED_ROUTE_METHOD} ${PROTECTED_ROUTE_PATH}`,
        timestamp: Date.now(),
        note: "Replace this demo response with your real business logic in this handler.",
      });
    },
  );

  app.post("/internal/reload-routes", async (_req, res) => {
    try {
      const routeInfo = await paymentGuard.refreshRequirements?.();
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
      route: `${paymentGuard.routeMethod || PROTECTED_ROUTE_METHOD} ${paymentGuard.routePath || PROTECTED_ROUTE_PATH}`,
      requirements: paymentGuard.getCurrentRouteInfo?.(),
    });
  });

  app.listen(MERCHANT_PORT, () => {
    console.log(`Merchant OS demo merchant server listening at http://localhost:${MERCHANT_PORT}`);
    console.log(`Environment: ${rb.environment}${RB_ENV === "sandbox" ? " (mapped from legacy RB_ENV=sandbox)" : ""}`);
    console.log(`Facilitator URL: ${rb.facilitatorUrl}`);
    console.log(`Merchant OS API URL: ${rb.merchantOsUrl}`);
    console.log(
      `Protected route: ${paymentGuard.routeMethod || PROTECTED_ROUTE_METHOD} ${paymentGuard.routePath || PROTECTED_ROUTE_PATH}`
    );
    console.log(
      `Settlement mode override: ${
        RB_SETTLEMENT_MODE_OVERRIDE || "auto (use product settlement policy)"
      }`
    );
    console.log(
      `Max payment options per challenge: ${Number.isFinite(RB_MAX_REQUIREMENT_OPTIONS) ? RB_MAX_REQUIREMENT_OPTIONS : defaultMaxPaymentOptions}`
    );
    console.log(
      `Source network filter: ${rb.environment === "live" ? "all" : "all (local default)"}`
    );
    console.log("Integration mode: abstracted SDK defaults with optional URL overrides");
  });

  paymentGuard.startAutoRefresh?.();
};

start().catch((error) => {
  console.error("Failed to start merchant-os demo merchant server", error);
  process.exit(1);
});
