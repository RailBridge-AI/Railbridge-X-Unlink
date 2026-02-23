import express from "express";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer } from "@x402/core/server";
import { declareCrossChainExtension, CROSS_CHAIN } from "./extensions/crossChain.js";
import { HTTPFacilitatorClient } from "@x402/core/http";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { createPaywall } from "@x402/paywall";
import { evmPaywall } from "@x402/paywall/evm";
import { loadFacilitatorEnv } from "./load-env.js";

loadFacilitatorEnv();

const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:4022";
const MERCHANT_OS_API_URL = process.env.MERCHANT_OS_API_URL || "http://localhost:4030";
const MERCHANT_OS_INTERNAL_TOKEN =
  process.env.MERCHANT_OS_INTERNAL_TOKEN || process.env.MERCHANT_OS_INGEST_TOKEN || "merchant-os-demo-ingest";
const MERCHANT_OS_MERCHANT_ID =
  process.env.MERCHANT_OS_MERCHANT_ID || "11111111-1111-4111-8111-111111111111";
const MERCHANT_OS_ACCOUNT_ID =
  process.env.MERCHANT_OS_ACCOUNT_ID || "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MERCHANT_OS_ROUTE_METHOD = String(process.env.MERCHANT_OS_ROUTE_METHOD || "GET").toUpperCase();
const MERCHANT_OS_ROUTE_PATH = process.env.MERCHANT_OS_ROUTE_PATH || "/api/premium";
const MERCHANT_OS_DEMO_SETTLEMENT_MODE =
  String(process.env.MERCHANT_OS_DEMO_SETTLEMENT_MODE || "same_chain").trim().toLowerCase();
const MERCHANT_PORT = Number.parseInt(process.env.MERCHANT_PORT || "4021", 10);

if (!MERCHANT_OS_INTERNAL_TOKEN) {
  console.error("MERCHANT_OS_INTERNAL_TOKEN (or MERCHANT_OS_INGEST_TOKEN) is required");
  process.exit(1);
}
if (
  MERCHANT_OS_DEMO_SETTLEMENT_MODE !== "same_chain" &&
  MERCHANT_OS_DEMO_SETTLEMENT_MODE !== "cross_chain"
) {
  console.error("MERCHANT_OS_DEMO_SETTLEMENT_MODE must be either 'same_chain' or 'cross_chain'");
  process.exit(1);
}

class LoggingFacilitatorClient extends HTTPFacilitatorClient {
  async settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    console.log("[merchant-os-demo] settle", {
      network: paymentRequirements.network,
      scheme: paymentRequirements.scheme,
    });
    return super.settle(paymentPayload, paymentRequirements);
  }

  async verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    console.log("[merchant-os-demo] verify", {
      network: paymentRequirements.network,
      scheme: paymentRequirements.scheme,
    });
    return super.verify(paymentPayload, paymentRequirements);
  }
}

type MerchantOsResolvedRequirement = {
  merchantId: string;
  accountId: string;
  settlementMode?: string;
  requirement: {
    scheme: string;
    network: string;
    price: {
      asset: string;
      amount: string;
      extra?: Record<string, unknown>;
    };
    payTo: `0x${string}`;
    extra?: Record<string, unknown>;
  };
  crossChain: null | {
    destinationNetwork: string;
    destinationAsset: string;
    destinationPayTo: `0x${string}`;
  };
  apiProduct: {
    apiName: string;
    description?: string | null;
  };
};

const facilitatorClient = new LoggingFacilitatorClient({
  url: FACILITATOR_URL,
});
const resourceServer = new x402ResourceServer(facilitatorClient);

registerExactEvmScheme(resourceServer, {
  networks: [
    "eip155:421614",
    "eip155:5042002",
    "eip155:84532",
    "eip155:11155111",
    "eip155:8453",
    "eip155:137",
    "eip155:1",
  ],
});

const paywall = createPaywall()
  .withNetwork(evmPaywall)
  .withConfig({
    appName: "RailBridge Merchant OS Demo Merchant",
    testnet: true,
  })
  .build();

const app = express();
app.use(express.json());

const routes: Record<string, any> = {};

const fetchResolvedRequirement = async (): Promise<MerchantOsResolvedRequirement> => {
  const response = await fetch(`${MERCHANT_OS_API_URL}/v1/demo/internal/requirements/resolve`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-merchant-os-internal-token": MERCHANT_OS_INTERNAL_TOKEN,
    },
    body: JSON.stringify({
      merchantId: MERCHANT_OS_MERCHANT_ID,
      accountId: MERCHANT_OS_ACCOUNT_ID,
      method: MERCHANT_OS_ROUTE_METHOD,
      path: MERCHANT_OS_ROUTE_PATH,
      settlementModeOverride: MERCHANT_OS_DEMO_SETTLEMENT_MODE,
    }),
  });

  const body = (await response.json().catch(() => ({}))) as any;
  if (!response.ok) {
    throw new Error(
      `Merchant OS requirement resolve failed (${response.status}): ${body.error || "unknown error"}`,
    );
  }
  return body as MerchantOsResolvedRequirement;
};

const rebuildRoutesFromMerchantOs = async () => {
  const resolved = await fetchResolvedRequirement();
  const routeKey = `${MERCHANT_OS_ROUTE_METHOD} ${MERCHANT_OS_ROUTE_PATH}`;

  const nextRoute: Record<string, unknown> = {
    accepts: [
      {
        scheme: resolved.requirement.scheme,
        network: resolved.requirement.network,
        price: resolved.requirement.price,
        payTo: resolved.requirement.payTo,
        merchantId: resolved.merchantId,
        accountId: resolved.accountId,
        extra: resolved.requirement.extra,
      },
    ],
    description:
      resolved.requirement.extra?.description ||
      resolved.apiProduct?.description ||
      resolved.apiProduct?.apiName ||
      "Merchant OS demo endpoint",
    mimeType: "application/json",
  };

  if (resolved.crossChain) {
    (nextRoute as any).extensions = {
      [CROSS_CHAIN]: declareCrossChainExtension({
        destinationNetwork: resolved.crossChain.destinationNetwork,
        destinationAsset: resolved.crossChain.destinationAsset,
        destinationPayTo: resolved.crossChain.destinationPayTo,
      }),
    };
  }

  Object.keys(routes).forEach((key) => delete routes[key]);
  routes[routeKey] = nextRoute;

  console.log("[merchant-os-demo] route config refreshed", {
    routeKey,
    payTo: resolved.requirement.payTo,
    sourceNetwork: resolved.requirement.network,
    crossChain: Boolean(resolved.crossChain),
    settlementMode: MERCHANT_OS_DEMO_SETTLEMENT_MODE,
  });
};

const registerRouteHandler = () => {
  const handler = (_req: express.Request, res: express.Response) => {
    res.json({
      message: "You successfully paid for this Merchant OS demo endpoint.",
      route: `${MERCHANT_OS_ROUTE_METHOD} ${MERCHANT_OS_ROUTE_PATH}`,
      timestamp: Date.now(),
    });
  };

  const method = MERCHANT_OS_ROUTE_METHOD.toLowerCase();
  if (typeof (app as any)[method] === "function") {
    (app as any)[method](MERCHANT_OS_ROUTE_PATH, handler);
    return;
  }
  app.all(MERCHANT_OS_ROUTE_PATH, handler);
};

const start = async () => {
  await rebuildRoutesFromMerchantOs();

  const middleware = paymentMiddleware(routes, resourceServer, undefined, paywall, true);
  app.use(middleware);

  registerRouteHandler();

  app.post("/internal/reload-routes", async (_req, res) => {
    try {
      await rebuildRoutesFromMerchantOs();
      return res.json({ success: true });
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
      route: `${MERCHANT_OS_ROUTE_METHOD} ${MERCHANT_OS_ROUTE_PATH}`,
      merchantId: MERCHANT_OS_MERCHANT_ID,
      accountId: MERCHANT_OS_ACCOUNT_ID,
    });
  });

  app.listen(MERCHANT_PORT, () => {
    console.log(`Merchant OS demo merchant server listening at http://localhost:${MERCHANT_PORT}`);
    console.log(`Facilitator URL: ${FACILITATOR_URL}`);
    console.log(`Merchant OS API URL: ${MERCHANT_OS_API_URL}`);
    console.log(`Protected route: ${MERCHANT_OS_ROUTE_METHOD} ${MERCHANT_OS_ROUTE_PATH}`);
    console.log(`Settlement mode override: ${MERCHANT_OS_DEMO_SETTLEMENT_MODE}`);
  });

  setInterval(() => {
    rebuildRoutesFromMerchantOs().catch((error) => {
      console.warn("[merchant-os-demo] route refresh failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, 30_000).unref();
};

start().catch((error) => {
  console.error("Failed to start merchant-os demo merchant server", error);
  process.exit(1);
});
