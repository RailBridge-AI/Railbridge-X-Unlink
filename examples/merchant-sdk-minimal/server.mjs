import express from "express";
import { createRailbridgeFromEnv } from "@railbridgeai/merchant-sdk";

const app = express();
const port = Number.parseInt(process.env.PORT || "4025", 10);
const rb = createRailbridgeFromEnv(process.env);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "merchant-sdk-minimal" });
});

await rb.protectExpress(
  app,
  {
    apiId: "premium_api",
    method: "GET",
    path: "/api/premium",
  },
  async (_req, res) => {
    // Keep your business logic inside the handler.
    res.json({
      ok: true,
      source: "merchant-sdk-minimal",
      message: "premium content unlocked via RailBridge merchant SDK",
    });
  },
);

app.listen(port, () => {
  console.log(`merchant-sdk-minimal listening on http://localhost:${port}`);
});
