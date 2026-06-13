# Welcome to RailBridge

Last reviewed: 2026-06-12

RailBridge helps merchants accept USDC payments from supported EVM chains using x402. Today the product is made up of two layers:

- **Merchant OS**: the merchant-facing control plane for onboarding, API keys, products, balances, settlements, payouts, and webhooks
- **Facilitator**: the payment plane that verifies x402 payments, settles them on-chain, and handles same-chain or cross-chain routing

## What RailBridge Is Today

RailBridge is no longer just a raw cross-chain facilitator. The current integration model is:

1. Merchants define paid products and routes in Merchant OS.
2. Merchant backends protect those routes with `@railbridgeai/merchant-sdk`.
3. Buyers pay with the standard x402 `exact` flow on a supported source chain.
4. The facilitator verifies and settles the payment, then handles routing if funds need to move across chains.
5. Merchant OS tracks the lifecycle and can deliver signed webhook events back to the merchant.

In the normal hosted flow, merchants should not manually call facilitator `/verify` or `/settle`; the SDK and payment middleware handle that wiring.

## Why Teams Use RailBridge

- **SDK-first integration**: Protect paid routes without mixing payment logic into business handlers
- **USDC-first simplicity**: Current merchant-facing flows are centered on USDC across supported networks
- **Same-chain and cross-chain support**: Accept payments where buyers already have funds and settle according to merchant routing needs
- **Merchant-facing operations**: Manage products, balances, settlements, payouts, API keys, and webhooks in one place
- **x402 compatibility**: Buyers still use normal x402 flows; cross-chain complexity stays behind the scenes

## How It Works

1. A merchant creates a paid product or route in Merchant OS.
2. The merchant backend mounts RailBridge route protection with the merchant SDK.
3. An unpaid request receives a standard `402 Payment Required` response.
4. The buyer retries with a signed x402 payment.
5. RailBridge verifies and settles the payment through the facilitator.
6. Merchant OS records lifecycle events and can notify the merchant via webhooks.

## Who This Documentation Is For

- **Merchant teams** adding paid routes to APIs or agent backends
- **Platform engineers** who want x402 payments without building chain-specific infrastructure
- **Buyer/client developers** paying RailBridge-protected routes from supported EVM wallets
- **Operators** running or evaluating the facilitator and testnet stack

## Start Here

- **Fastest merchant path**: [Merchant Integration Guide](../merchant-os/AGENT_INTEGRATION_GUIDE.md)
- **Merchant SDK reference**: [@railbridgeai/merchant-sdk](../packages/server-sdk/README.md)
- **Runnable minimal example**: [Merchant SDK Minimal Example](../examples/merchant-sdk-minimal/README.md)
- **Facilitator setup and API surface**: [Facilitator README](README.md)
- **Local facilitator walkthrough**: [Quickstart](quickstart.md)
- **Buyer/client flow**: [Client Quickstart](QUICKSTART_CLIENT.md)
- **Architecture deep dive**: [Facilitator Architecture](documentation/ARCHITECTURE.md)
- **Supported chains and USDC addresses**: [Supported Networks](documentation/SUPPORTED_NETWORKS.md)

## Key Concepts

- **Merchant OS**: the merchant control plane and merchant-facing API surface
- **Facilitator**: the x402 payment plane for verification, settlement, and routing
- **Merchant SDK**: the preferred merchant integration surface for route protection and webhook verification
- **x402 `exact` scheme**: the current buyer payment flow used by RailBridge integrations
- **Same-chain settlement**: funds stay on the network where the buyer paid
- **Cross-chain settlement**: funds are routed toward the merchant's preferred destination network

## Need Help?

- Start with the [repo overview](../README.md) for local development and public testnet URLs
- Review [Merchant OS](../merchant-os/README.md) for the merchant-facing product model
- Use the [Quickstart](quickstart.md) if you want to run the facilitator locally
- Explore the example servers in `src/` if you are working inside this repository

---

**Ready to build?** Start with the [Merchant Integration Guide](../merchant-os/AGENT_INTEGRATION_GUIDE.md) if you are integrating a backend, or the [Client Quickstart](QUICKSTART_CLIENT.md) if you are building a payer.
