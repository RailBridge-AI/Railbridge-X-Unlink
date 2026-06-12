## Client Quickstart (Buyers)

Last reviewed: 2026-06-12

This guide is for clients or buyers that need to pay a RailBridge-protected route.

Important: the Merchant SDK is server-side. Buyer integrations still use the x402 client stack directly:

- `@x402/core`
- `@x402/evm`
- `@x402/fetch`
- `viem`

The good news is that buyers still use the normal x402 `exact` flow. They do not need to understand Merchant OS, payout flows, or cross-chain routing internals.

## 1) Prerequisites

- Node.js 18+
- A wallet private key for the paying account
- RPC URLs for the networks you want to pay from
- A merchant endpoint that is already protected by RailBridge

If you are testing locally in this repo:

- use `http://localhost:4025` when paying the SDK-first `merchant-sdk-minimal` example
- use `http://localhost:4021` only if you are intentionally paying one of the older facilitator demo merchants

## 2) Install Client Packages

In your client project:

```bash
npm install @x402/core @x402/evm @x402/fetch viem
```

## 3) Configure Environment Variables

Example environment:

```env
CLIENT_PRIVATE_KEY=0xYourPrivateKeyHere
CLIENT_RPC_OVERRIDES_JSON={"eip155:84532":"https://sepolia.base.org","eip155:421614":"https://arbitrum-sepolia-rpc.publicnode.com"}
CLIENT_DEFAULT_RPC_URL=https://sepolia.base.org
MERCHANT_URL=http://localhost:4025
```

Variable meanings:

- `CLIENT_PRIVATE_KEY`: private key for the payer wallet
- `CLIENT_RPC_OVERRIDES_JSON`: per-network RPC map for offered payment options
- `CLIENT_DEFAULT_RPC_URL`: fallback RPC when a network is not present in the map
- `MERCHANT_URL`: base URL of the merchant backend you are paying

Recommendation:

1. Add explicit RPCs for every network the merchant is likely to offer.
2. Do not rely on a single fallback RPC for a multi-network payment flow.

## 4) Basic Client Setup

This is the core pattern:

```ts
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import type { PaymentRequirements } from "@x402/core/types";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const merchantUrl = process.env.MERCHANT_URL || "http://localhost:4025";
const signer = privateKeyToAccount(process.env.CLIENT_PRIVATE_KEY as `0x${string}`);

const parseRpcOverrides = (raw: string) => {
  if (!raw) return {} as Record<string, string>;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([network, url]) => /^eip155:[0-9]+$/.test(network) && typeof url === "string")
        .map(([network, url]) => [network, String(url).trim()])
        .filter(([, url]) => /^https?:\/\//.test(url)),
    ) as Record<string, string>;
  } catch {
    return {} as Record<string, string>;
  }
};

const rpcByNetwork = parseRpcOverrides(String(process.env.CLIENT_RPC_OVERRIDES_JSON || "").trim());
const fallbackRpc = String(process.env.CLIENT_DEFAULT_RPC_URL || "").trim();
const resolveRpcForNetwork = (network: string) => rpcByNetwork[network] || fallbackRpc;

const preferredNetworks: Array<`${string}:${string}`> = [
  "eip155:84532",
  "eip155:421614",
  "eip155:8453",
  "eip155:1",
  "eip155:137",
];

const networkSelector = (
  _x402Version: number,
  options: PaymentRequirements[],
): PaymentRequirements => {
  for (const preferredNetwork of preferredNetworks) {
    const match = options.find(
      (opt) => opt.network === preferredNetwork && Boolean(resolveRpcForNetwork(opt.network)),
    );
    if (match) return match;
  }

  const firstRpcBacked = options.find((opt) => Boolean(resolveRpcForNetwork(opt.network)));
  if (firstRpcBacked) return firstRpcBacked;

  return options[0];
};

const client = new x402Client(networkSelector);
registerExactEvmScheme(client, { signer });

const fetchWithPayment = wrapFetchWithPayment(fetch, client);
```

What this setup does:

1. selects a preferred payment option when multiple networks are offered
2. avoids picking a network that has no configured RPC when possible
3. retries automatically after the initial `402 Payment Required`

## 5) Make a Paid Request

Use `fetchWithPayment(...)` instead of raw `fetch(...)`:

```ts
async function getPremiumContent() {
  const response = await fetchWithPayment(`${merchantUrl}/api/premium`, {
    method: "GET",
  });

  if (!response.ok) {
    console.error("Request failed:", response.status, await response.text());
    return;
  }

  const data = await response.json();
  console.log("Premium content:", data);
}

getPremiumContent().catch(console.error);
```

Behind the scenes:

1. the first request returns `402 Payment Required`
2. the client reads the payment options
3. the client selects an `exact` EVM requirement
4. the client signs the payment payload
5. the client retries the request with payment attached

## 6) Read the Payment Receipt

After a successful payment, the merchant returns settlement data in response headers.

```ts
import { x402HTTPClient } from "@x402/core/client";

async function getPremiumContentWithReceipt() {
  const response = await fetchWithPayment(`${merchantUrl}/api/premium`);

  if (!response.ok) {
    console.error("Request failed:", response.status, await response.text());
    return;
  }

  const httpClient = new x402HTTPClient(client);
  const receipt = httpClient.getPaymentSettleResponse(
    (name) => response.headers.get(name),
  );

  if (receipt) {
    console.log("Transaction:", receipt.transaction);
    console.log("Network:", receipt.network);
    console.log("Success:", receipt.success);
    console.log("Payer:", receipt.payer);
  }

  const data = await response.json();
  console.log("Response:", data);
}
```

For cross-chain payments:

1. the receipt transaction is still the source-chain settlement transaction
2. any bridge step happens asynchronously after settlement

## 7) Cross-Chain Still Looks Normal to the Buyer

When a merchant uses cross-chain settlement:

- the client still sees a normal `exact` payment option on the source network
- the client still signs a normal payment payload
- the facilitator handles routing and any bridge behavior after settlement

The buyer does not need separate cross-chain logic.

## 8) Important USDC Domain Note

The simple `registerExactEvmScheme(client, { signer })` path is still a good starting point.

However, the runnable repo example in [client-example.ts](src/client-example.ts) now uses a domain-aware exact scheme helper from [exact-evm-domain.ts](src/schemes/exact-evm-domain.ts).

Why:

1. some USDC routes include extra EIP-712 domain metadata
2. some networks need custom domain fields beyond the simplest exact-EVM client path
3. the domain-aware helper avoids a class of signature failures that show up as `invalid_payment`

If you are working inside this repo, follow the runnable client example.

If you are integrating outside this repo and hit domain/signature issues on USDC routes:

1. compare your client against `facilitator/src/client-example.ts`
2. mirror the logic in `facilitator/src/schemes/exact-evm-domain.ts`

## 9) Local Repo Flow

If you want a current end-to-end local test using the SDK-first merchant path:

### 9.1 Start local services

From the repo root:

```bash
npm --prefix merchant-os install
npm --prefix facilitator install
```

In separate terminals:

```bash
npm --prefix merchant-os run start:api
```

```bash
npm --prefix facilitator run dev
```

### 9.2 Start the local SDK merchant example

From `examples/merchant-sdk-minimal`:

```bash
cp .env.example .env
npm install
npm run bootstrap:local
npm start
```

This starts the protected merchant route on `http://localhost:4025`.

### 9.3 Point the client at that merchant

In `facilitator/.env` or your client environment:

```env
MERCHANT_URL=http://localhost:4025
CLIENT_PRIVATE_KEY=0xYourPrivateKeyHere
CLIENT_RPC_OVERRIDES_JSON={"eip155:84532":"https://sepolia.base.org"}
CLIENT_DEFAULT_RPC_URL=https://sepolia.base.org
```

### 9.4 Run the runnable client example

From the repo root:

```bash
npm --prefix facilitator run example:client
```

## 10) Troubleshooting

Common failures and what to check:

- `402 Payment Required` loop:
  - confirm `registerExactEvmScheme(...)` or your domain-aware exact client is registered
  - confirm the merchant offered at least one network your client can actually pay on
- no compatible network works:
  - check `CLIENT_RPC_OVERRIDES_JSON`
  - make sure you have RPC coverage for the offered networks
- `invalid_payment`:
  - check domain metadata, signer setup, and USDC EIP-712 handling
  - compare against `src/client-example.ts`
- insufficient funds:
  - make sure the payer wallet has enough USDC and native gas
- settlement still fails after signing:
  - the facilitator relayer may be missing gas on the selected source network

## 11) Next Steps

- Review the runnable client example: [client-example.ts](src/client-example.ts)
- Review supported networks and USDC addresses: [SUPPORTED_NETWORKS.md](documentation/SUPPORTED_NETWORKS.md)
- Review the merchant-side integration path: [quickstart.md](quickstart.md)
