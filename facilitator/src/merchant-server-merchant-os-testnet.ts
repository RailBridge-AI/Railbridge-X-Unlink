import express from "express";
import { loadFacilitatorEnv } from "./load-env.js";
import { createRailbridgeFromEnv } from "@railbridgeai/merchant-sdk";

loadFacilitatorEnv();

const RB_API_KEY = String(process.env.RB_API_KEY || "").trim();
const RB_API_ID = String(process.env.RB_API_ID || "").trim();
const RB_SETTLEMENT_MODE_OVERRIDE = String(process.env.RB_SETTLEMENT_MODE_OVERRIDE || "")
  .trim()
  .toLowerCase();
const RB_MAX_REQUIREMENT_OPTIONS = Number.parseInt(
  process.env.RB_MAX_REQUIREMENT_OPTIONS || process.env.RB_MAX_PAYMENT_OPTIONS || "32",
  10,
);
const MERCHANT_PORT = Number.parseInt(process.env.PORT || "4021", 10);
const PROTECTED_ROUTE_METHOD = "GET";
const PROTECTED_ROUTE_PATH = "/api/premium";

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
    environment: "testnet",
    maxRequirementOptions: Number.isFinite(RB_MAX_REQUIREMENT_OPTIONS)
      ? RB_MAX_REQUIREMENT_OPTIONS
      : 32,
    logPrefix: "[merchant-os-testnet-demo]",
    paywallAppName: "RailBridge Merchant OS Testnet Demo Merchant",
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
        : 32,
      logPrefix: "[merchant-os-testnet-demo]",
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
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      route: `${paymentGuard.routeMethod || PROTECTED_ROUTE_METHOD} ${paymentGuard.routePath || PROTECTED_ROUTE_PATH}`,
      requirements: paymentGuard.getCurrentRouteInfo?.()
    });
  });

  app.listen(MERCHANT_PORT, () => {
    console.log(`Merchant OS testnet demo merchant server listening at http://localhost:${MERCHANT_PORT}`);
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
      `Max payment options per challenge: ${Number.isFinite(RB_MAX_REQUIREMENT_OPTIONS) ? RB_MAX_REQUIREMENT_OPTIONS : 32}`
    );
    console.log("Source network filter: testnet_only (default for environment=testnet)");
    console.log("Integration mode: hosted RailBridge testnet defaults with optional URL overrides");
  });

  paymentGuard.startAutoRefresh?.();
};

start().catch((error) => {
  console.error("Failed to start merchant-os testnet demo merchant server", error);
  process.exit(1);
});
