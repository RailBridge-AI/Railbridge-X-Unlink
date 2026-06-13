import express from "express";
import { createRailbridgeFromEnv } from "../src/index.js";

const app = express();
const rb = createRailbridgeFromEnv(process.env);

const start = async () => {
  const premiumGate = await rb.protectExpress(
    app,
    {
      apiId: process.env.RB_API_ID || "premium_api",
      method: "GET",
      path: "/api/premium",
    },
    async (_req, res) => {
      res.json({ ok: true, message: "Paid access granted" });
    },
  );

  premiumGate.startAutoRefresh?.();

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/webhooks/railbridge", express.text({ type: "application/json" }));
  app.post(
    "/webhooks/railbridge",
    rb.webhooks.express({
      secret: process.env.RB_WEBHOOK_SECRET,
      onEvent: async (event) => {
        console.log("railbridge event", event.type, event.id);
      },
    }),
  );

  const port = Number(process.env.PORT || 4021);
  app.listen(port, () => {
    console.log(`merchant backend listening on http://localhost:${port}`);
  });
};

start().catch((error) => {
  console.error("failed to start merchant backend", error);
  process.exit(1);
});
