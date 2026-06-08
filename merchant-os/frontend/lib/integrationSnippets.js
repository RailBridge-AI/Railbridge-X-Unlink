export const BACKEND_REQUIREMENTS_SNIPPET = `import express from "express";
import { createRailbridgeFromEnv } from "@railbridgeai/merchant-sdk";

const app = express();
const rb = createRailbridgeFromEnv(process.env);

async function start() {
  await rb.protectExpress(
    app,
    {
      apiId: "premium_api",
      method: "GET",
      path: "/api/premium"
    },
    async (req, res) => {
      // Keep your business logic here.
      const report = await premiumReportService.generate({
        customerId: req.header("x-customer-id")
      });

      return res.json(report);
    }
  );

  app.listen(4021);
}

start().catch(console.error);`;

export const BACKEND_REQUIREMENTS_CURL = `# Optional low-level connectivity check
curl -X POST "https://api.testnet.railbridge.ai/v1/sdk/requirements/resolve" \\
  -H "content-type: application/json" \\
  -H "x-railbridge-api-key: $RB_API_KEY" \\
  -d '{
    "apiId":"premium_api",
    "method":"GET",
    "path":"/api/premium"
  }'`;
