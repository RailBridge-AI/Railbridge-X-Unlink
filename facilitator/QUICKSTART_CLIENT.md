## Client Quickstart (Buyers)

This guide is for **clients / buyers** who want to integrate RailBridge x402 payments into their applications to pay protected merchant routes.

### 1. Prerequisites

- Node.js 18+ and npm
- Access to an EVM testnet RPC (for example, Base Sepolia)
- A funded client wallet on the source chain (for example, Base Sepolia)
- A merchant server that is already integrated with RailBridge x402

### 2. Install Client Packages

In your project, install the required x402 client packages:

```bash
npm install @x402/core @x402/evm @x402/fetch viem
```

### 3. Configure Environment Variables

Set these environment variables in your environment (for example, `.env`):

```bash
CLIENT_PRIVATE_KEY=0xYourClientPrivateKey
CLIENT_RPC_OVERRIDES_JSON={"eip155:84532":"https://sepolia.base.org","eip155:421614":"https://arbitrum-sepolia-rpc.publicnode.com"}
CLIENT_DEFAULT_RPC_URL=https://sepolia.base.org
MERCHANT_URL=http://localhost:4021
```

- `CLIENT_PRIVATE_KEY` - Private key for the client wallet (testnet)
- `CLIENT_RPC_OVERRIDES_JSON` - per-network RPC map used for multi-chain payment options
- `CLIENT_DEFAULT_RPC_URL` - optional fallback RPC if a network is missing from the map
- `MERCHANT_URL` - Base URL of the merchant server you are paying

### 4. Basic Client Setup

Create an x402 client that can pay EVM `exact` scheme requirements:

```typescript
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";
import { baseSepolia } from "viem/chains";

// Create signer from private key
const signer = privateKeyToAccount(process.env.CLIENT_PRIVATE_KEY as `0x${string}`);

const rpcByNetwork = JSON.parse(process.env.CLIENT_RPC_OVERRIDES_JSON || "{}");
const resolveRpcUrl = (network: string) =>
  rpcByNetwork[network] || process.env.CLIENT_DEFAULT_RPC_URL || "https://sepolia.base.org";
const createClientForNetwork = (network: string) =>
  createWalletClient({
    account: signer,
    chain: baseSepolia,
    transport: http(resolveRpcUrl(network)),
  });

// Create x402 client
const client = new x402Client();

// Register EVM scheme - works for both same-chain and cross-chain
registerExactEvmScheme(client, { signer });

// Wrap fetch with payment handling
const fetchWithPayment = wrapFetchWithPayment(fetch, client);
```

### 5. Making a Payment-Protected Request

Use `fetchWithPayment` instead of `fetch` for routes that require payment:

```typescript
const merchantUrl = process.env.MERCHANT_URL || "http://localhost:4021";

async function getPremiumContent() {
  const response = await fetchWithPayment(`${merchantUrl}/api/premium`);

  console.log("Status:", response.status);

  if (response.ok) {
    const data = await response.json();
    console.log("Premium content:", data);
  } else {
    console.error("Request failed:", response.status, await response.text());
  }
}

getPremiumContent().catch(console.error);
```

The client will:

1. Receive a `402 Payment Required` response from the merchant.
2. Read the x402 payment requirements from the `Payment-Required` header.
3. Select a compatible `exact` EVM requirement.
4. Construct and sign a `paymentPayload` using your wallet.
5. Retry the request with the signed payment attached.

### 6. Selecting Preferred Networks (Optional)

If the merchant offers multiple networks, you can provide a custom network selector:

```typescript
import type { PaymentRequirements } from "@x402/core/types";
import { x402Client } from "@x402/core/client";

const networkSelector = (
  _x402Version: number,
  options: PaymentRequirements[],
): PaymentRequirements => {
  const preferredNetworks = ["eip155:84532", "eip155:8453"]; // Base Sepolia, Base Mainnet

  for (const preferredNetwork of preferredNetworks) {
    const match = options.find((opt) => opt.network === preferredNetwork);
    if (match) return match;
  }

  // Fallback to first available option
  return options[0];
};

const client = new x402Client(networkSelector);
registerExactEvmScheme(client, { signer });
```

### 7. Reading Payment Receipts

After a successful payment, the merchant returns a `PAYMENT-RESPONSE` header with settlement details:

```typescript
import { httpClient } from "@x402/core/http";

async function getPremiumContentWithReceipt() {
  const response = await fetchWithPayment(`${merchantUrl}/api/premium`);

  if (!response.ok) {
    console.error("Request failed:", response.status, await response.text());
    return;
  }

  try {
    const receipt = httpClient.getPaymentSettleResponse(response);
    console.log("Payment successful");
    console.log("Transaction:", receipt.transaction);
    console.log("Network:", receipt.network);
    console.log("Payer:", receipt.payer);
  } catch (error) {
    console.warn("Could not extract payment receipt:", error);
  }

  const data = await response.json();
  console.log("Response:", data);
}
```

### 8. Cross-Chain Transparency

For cross-chain payments:

- The client only sees `scheme: "exact"` and a source `network` (for example, `eip155:84532`).
- The cross-chain details are encoded in extensions and handled by the merchant and facilitator.
- The client does not need any cross-chain-specific logic; it simply pays the requirement it selects.

### 9. Error Handling

Common client-side issues:

- **402 Payment Required loops**:
  - Ensure the client is correctly registered with `registerExactEvmScheme`.
  - Confirm the client supports the network and asset advertised by the merchant.

- **Signature or gas errors**:
  - Check that `CLIENT_PRIVATE_KEY` and `CLIENT_RPC_OVERRIDES_JSON` are correct.
  - Ensure the client wallet has enough funds for gas and the payment amount.

### 10. Next Steps

- Review the example client in this repository: `src/client-example.ts`.
- Add UI around the payment flow (for example, showing progress, errors, and receipts).
- Integrate with your application's routing and state management.







