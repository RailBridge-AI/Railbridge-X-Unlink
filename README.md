# RailBridge Cross-Chain x402 Facilitator

A cross-chain payment facilitator for the x402 protocol, enabling payments where users pay on one EVM blockchain and servers receive on another EVM blockchain.

## Features

- **Multi-chain EVM support**: Base, Ethereum Mainnet, Polygon, and their testnets
- **Cross-chain payments**: Pay on any supported EVM chain, receive on any other
- **Secure verification**: Reuses Coinbase's battle-tested x402 implementations
- **Easy integration**: Standard x402 protocol endpoints
- **Rich paywall UI**: Integrated `@x402/paywall` for seamless wallet connection and payment flow
- **Flexible bridging**: Can disable cross-chain bridging for testing (settles on source chain only)

## Architecture

This facilitator extends the x402 protocol by:

1. **Reusing existing schemes**: Uses `@x402/evm/exact` for single-chain payments
2. **Adding cross-chain routing**: Implements a `CrossChainRouter` that:
   - Acts as a routing wrapper around `ExactEvmScheme`
   - Handles network mismatch between source (where user pays) and destination (where merchant receives)
   - Verifies and settles payments on the source chain
   - Bridges funds to destination chain via `BridgeService` (asynchronously after settlement)
   - Falls back to direct settlement on source chain when bridging is disabled

### Key Components

- **`CrossChainRouter`**: Facilitator-side routing wrapper that delegates to `ExactEvmScheme` for source chain operations, then triggers bridging
- **`CrossChainServerScheme`**: Server-side scheme that satisfies validation for "cross-chain" routes (delegates to `ExactEvmScheme` for price parsing and requirement building)
- **`BridgeService`**: Stub service for actual bridge integration (Wormhole, LayerZero, or custom)
- **Cross-chain extension**: Custom x402 extension that carries source chain information from client to facilitator

## Testnet VPS Deployment

For shared-VPS deployment with Traefik ingress and `*.testnet.env` config naming, use:

- `deploy/testnet/README.md`
- `deploy/testnet/docker-compose.testnet.yml`
- `deploy/testnet/prepare-testnet-runtime-configs.sh`

## Setup

### 1. Install Dependencies

```bash
cd facilitator
npm install
```

### 2. Configure Environment

Copy `env.template` to `.env` and fill in your configuration:

```bash
cp env.template .env
```

**Required variables for facilitator:**
- `EVM_PRIVATE_KEY`: Private key for EVM facilitator wallet (must have funds for gas)
- `EVM_RPC_URL`: RPC endpoint for EVM chains (defaults to Base Sepolia testnet)
- `CROSS_CHAIN_ENABLED`: Set to `false` to disable bridging (settle on source chain only, useful for testing)

**Optional variables:**
- `PORT`: Facilitator server port (default: 4022)
- `DEPLOY_ERC4337_WITH_EIP6492`: Set to `true` to enable automatic smart wallet deployment

**For merchant server:**
- `FACILITATOR_URL`: URL of the facilitator (default: http://localhost:4022)
- `MERCHANT_ADDRESS`: Address where you want to receive payments on destination chain
- `MERCHANT_PORT`: Merchant server port (default: 4021)

**For client examples:**
- `CLIENT_PRIVATE_KEY`: Your wallet private key for making payments
- `MERCHANT_URL`: URL of the merchant server (default: http://localhost:4021)

### 3. Run

**Start the facilitator:**
```bash
# Development (with hot reload)
npm run dev

# Production
npm run build
npm start
```

**Start the merchant server (in a separate terminal):**
```bash
npm run test:merchant
```

**Run client example:**
```bash
npm run example:client
```

## API Endpoints

### POST /verify

Verify a payment payload against requirements.

**Request:**
```json
{
  "paymentPayload": {
    "x402Version": 2,
    "resource": { ... },
    "accepted": {
      "scheme": "cross-chain",
      "network": "eip155:84532",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "amount": "10000",
      "payTo": "0x...",
      ...
    },
    "payload": { ... },
    "extensions": {
      "cross-chain": {
        "sourceNetwork": "eip155:84532",
        "sourceAsset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
      }
    }
  },
  "paymentRequirements": { ... }
}
```

**Response:**
```json
{
  "isValid": true,
  "payer": "0x..."
}
```

### POST /settle

Settle a payment on-chain.

**Request:** Same as `/verify`

**Response:**
```json
{
  "success": true,
  "transaction": "0x...",
  "network": "eip155:84532",
  "payer": "0x..."
}
```

### GET /supported

Get list of supported payment schemes and networks.

**Response:**
```json
{
  "kinds": [
    {
      "x402Version": 2,
      "scheme": "exact",
      "network": "eip155:84532",
      ...
    },
    {
      "x402Version": 2,
      "scheme": "cross-chain",
      "network": "eip155:84532",
      "extra": {
        "crossChain": true
      }
    }
  ],
  "extensions": ["cross-chain"],
  "signers": { ... }
}
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "facilitator": "railbridge-cross-chain"
}
```

## How Cross-Chain Payments Work

### Flow Overview

1. **Client** requests protected resource from merchant server
2. **Merchant server** responds with `402 Payment Required`, including:
   - Payment options (same-chain "exact" and/or cross-chain)
   - Cross-chain extension with source chain info
3. **Client** selects payment option and creates payment payload:
   - Signs payment on source chain (e.g., Base Sepolia)
   - Includes cross-chain extension with source network/asset
4. **Merchant server** calls facilitator `/verify`:
   - Facilitator extracts cross-chain extension
   - Routes to `CrossChainRouter` which delegates to `ExactEvmScheme`
   - Verifies payment signature on source chain
5. **Merchant server** calls facilitator `/settle`:
   - Facilitator settles payment on source chain (funds go to bridge lock address if bridging enabled, or directly to merchant if disabled)
   - `onAfterSettle` hook triggers asynchronous bridging (if enabled)
   - Bridge service transfers funds to destination chain
6. **Merchant server** receives settlement confirmation and fulfills request

### When Bridging is Disabled

When `CROSS_CHAIN_ENABLED=false`:
- Payment settles directly to merchant address on source chain
- No bridging occurs
- Useful for testing same-chain flows without bridge integration

### Bridge Lock Address

When bridging is enabled:
- Funds are settled to a bridge lock address on the source chain
- The bridge service then transfers these funds to the merchant on the destination chain
- Accounting for bridged funds is handled by the bridge service (event-based for existing bridges, or on-chain mappings for custom bridges)

## Merchant Server Integration

The merchant server (`src/merchant-server.ts`) demonstrates how to integrate with the RailBridge facilitator:

- Uses `@x402/express` `paymentMiddleware` to protect routes
- Registers both "exact" and "cross-chain" schemes
- Integrates `@x402/paywall` for rich wallet connection UI
- Defines payment-protected routes with multiple payment options

**Example route configuration:**
```typescript
const routes = {
  "GET /api/premium": {
    accepts: [
      {
        scheme: "exact",
        network: "eip155:84532",
        price: "$0.01",
        payTo: MERCHANT_ADDRESS,
      },
      {
        scheme: "cross-chain",
        network: "eip155:84532",
        price: "$0.01",
        payTo: MERCHANT_ADDRESS,
        extra: {
          description: "Cross-chain payment",
        },
      },
    ],
    extensions: {
      "cross-chain": declareCrossChainExtension(
        "eip155:84532", // Source network
        "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Source asset (USDC)
      ),
    },
  },
};
```

## Client Integration

The client example (`src/client-example.ts`) demonstrates how clients interact with the merchant server:

- Uses `@x402/fetch` `wrapFetchWithPayment` for automatic payment handling
- Registers EVM schemes for payment signing
- Custom network selector for preferred network selection
- Detailed error logging for payment failures

**Example usage:**
```typescript
const fetchWithPayment = wrapFetchWithPayment(fetch, {
  client: x402Client,
  httpClient: x402HTTPClient,
});

const response = await fetchWithPayment(`${MERCHANT_URL}/api/premium`, {
  method: "GET",
});
```

## Bridge Integration

The `BridgeService` class (`src/services/bridgeService.ts`) is a stub that needs to be integrated with your actual bridge:

- **Wormhole**: For cross-chain message passing
- **LayerZero**: For omnichain interoperability
- **Custom RailBridge**: Your own bridge implementation

The service interface includes:
- `checkLiquidity()`: Verify bridge has sufficient liquidity
- `bridge()`: Execute the bridge transfer
- `getBridgeLockAddress()`: Get the lock address for a given network pair

See `src/services/bridgeService.ts` for the interface to implement.

## Development

### Project Structure

```
facilitator/
├── src/
│   ├── facilitator-implementation.ts  # Main facilitator server
│   ├── merchant-server.ts             # Example merchant server
│   ├── client-example.ts              # Example client implementation
│   ├── schemes/
│   │   ├── crossChainRouter.ts        # Facilitator-side cross-chain routing
│   │   └── crossChainServer.ts        # Server-side cross-chain scheme
│   ├── extensions/
│   │   └── crossChain.ts              # Cross-chain extension definition
│   ├── services/
│   │   └── bridgeService.ts           # Bridge service (stub)
│   └── types/
│       └── bridge.ts                  # Bridge types
├── package.json
├── tsconfig.json
├── env.template                       # Environment variable template
└── README.md
```

### Supported Networks

Currently supported EVM networks:
- `eip155:8453` - Base Mainnet
- `eip155:84532` - Base Sepolia (testnet)
- `eip155:1` - Ethereum Mainnet
- `eip155:137` - Polygon

To add more networks:
1. Register the network in `registerExactEvmScheme()` call in `facilitator-implementation.ts`
2. Register the network in `CrossChainRouter` registration
3. Update merchant server to register the network in both schemes
4. Update bridge service if needed for chain-specific logic

### Testing

```bash
# Type check
npm run typecheck

# Lint
npm run lint

# Run facilitator
npm run dev

# Run merchant server (in separate terminal)
npm run test:merchant

# Run client example (in separate terminal)
npm run example:client
```

### Lifecycle Hooks

The facilitator supports lifecycle hooks for monitoring and custom logic:

- `onBeforeVerify`: Called before payment verification
- `onAfterVerify`: Called after successful verification
- `onBeforeSettle`: Called before payment settlement
- `onAfterSettle`: Called after successful settlement (used for triggering bridging)
- `onSettleFailure`: Called when settlement fails

See `facilitator-implementation.ts` for examples of hook usage.

## License

MIT
