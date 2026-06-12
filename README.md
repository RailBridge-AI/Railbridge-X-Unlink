# RailBridge AI Monorepo

RailBridge helps merchants accept USDC payments across chains using x402, with a merchant-facing control plane (Merchant OS) and facilitator infrastructure.

## What Is In This Repository

- `merchant-os/`
  - Merchant-facing API + web console.
  - Merchants configure paid routes/products, view balances/settlements, and request payouts.
- `facilitator/`
  - x402 facilitator for verify/settle/supported flows.
  - Handles same-chain and cross-chain settlement flow orchestration.
- `deploy/testnet/`
  - Shared-VPS deployment stack (Docker Compose + Traefik labels + config mapping scripts).
- `railbridge-landing/`
  - Marketing site (already deployed separately on Vercel).

## Current Testnet Domains

- Merchant OS web: `https://app.testnet.railbridge.ai`
- Merchant OS API: `https://api.testnet.railbridge.ai`
- Facilitator API: `https://facilitator.testnet.railbridge.ai`
- Demo merchant backend: `https://demo.testnet.railbridge.ai`

## Configuration Model

RailBridge uses a split between secrets and non-secrets:

- Secrets live in `.env` files.
- Non-secret runtime options live in JSON runtime config files.

Examples:

- Merchant OS:
  - Secrets: `merchant-os/.env`
  - Non-secrets: `merchant-os/config/runtime-config.json` + optional `runtime-config.local.json`
- Facilitator:
  - Secrets: `facilitator/.env`
  - Non-secrets: `facilitator/config/runtime-config.json` + optional `runtime-config.local.json`

For VPS testnet deployment, source files are intentionally named with testnet suffixes:

- `merchant-os.testnet.env`
- `merchant-web.testnet.env`
- `facilitator.testnet.env`
- `demo-merchant.testnet.env`
- `merchant-os.runtime-config.testnet.json`
- `facilitator.runtime-config.testnet.json`

These are mapped into runtime file names by:

- `deploy/testnet/prepare-testnet-runtime-configs.sh`

## Local Development Quick Start

1. Install dependencies:

```bash
npm --prefix merchant-os install
npm --prefix merchant-os/frontend install
npm --prefix facilitator install
```

2. Run Merchant OS API:

```bash
npm --prefix merchant-os run dev:api
```

3. Run Merchant OS frontend:

```bash
npm --prefix merchant-os run dev:web
```

4. Run Facilitator:

```bash
npm --prefix facilitator run dev
```

Default local URLs:

- Merchant OS web: `http://localhost:3000`
- Merchant OS API: `http://localhost:4030`
- Facilitator: `http://localhost:4022`

## Testnet Deployment (Shared VPS)

Primary docs and assets:

- `deploy/testnet/README.md`
- `deploy/testnet/docker-compose.testnet.yml`
- `deploy/testnet/preflight-shared-vps.sh`
- `deploy/testnet/prepare-testnet-runtime-configs.sh`

The stack is designed so:

- Traefik is the only ingress exposing `80/443`.
- RailBridge services run in their own compose project.
- Testnet config artifacts stay on VPS only.

## GitHub Actions Deployment

Workflow:

- `.github/workflows/deploy-testnet.yml`

Trigger:

- Push to `testnet` branch (or manual `workflow_dispatch`).

Required GitHub secrets:

- `TESTNET_VPS_HOST`
- `TESTNET_VPS_USER`
- `TESTNET_VPS_SSH_KEY`
- `TESTNET_APP_DIR`
- `TESTNET_CONFIG_DIR`

Recommended secrets:

- `TESTNET_APP_HOST`
- `TESTNET_API_HOST`
- `TESTNET_FACILITATOR_HOST`
- `TESTNET_DEMO_MERCHANT_HOST`
- `TESTNET_MERCHANT_OS_DATA_DIR`
- `TESTNET_FACILITATOR_DATA_DIR`
- `TRAEFIK_NETWORK`
- `TRAEFIK_ENTRYPOINT`
- `TRAEFIK_CERT_RESOLVER`

## Demo Merchant Flow (Public Testnet)

Health check:

```bash
curl -i https://demo.testnet.railbridge.ai/health
```

Protected route should return `402 Payment Required`:

```bash
curl -i https://demo.testnet.railbridge.ai/api/premium
```

Run public-testnet payer script:

```bash
npm --prefix facilitator run test:accept-payment-existing-merchant-public-testnet
```

Notes:

- `CLIENT_PRIVATE_KEY` is required for the payer wallet.
- `RB_API_KEY` is optional for observer verification. If invalid/missing, payment can still run by disabling observer behavior.

## Environment Rules For Deployed Testnet

- Use `NODE_ENV=production` in deployed containers.
- Optional label variable: `RAILBRIDGE_ENV=testnet`.
- Use dedicated testnet data directories to avoid mixing with non-testnet state.

## Additional Documentation

- Merchant OS guide: `merchant-os/README.md`
- SDK-first merchant integration guide: `merchant-os/AGENT_INTEGRATION_GUIDE.md`
- Thin SDK package: `packages/server-sdk/README.md`
- Facilitator guide: `facilitator/README.md`
- Testnet deploy guide: `deploy/testnet/README.md`
- Merchant OS runtime config guide: `merchant-os/config/README.md`
- Facilitator runtime config guide: `facilitator/config/README.md`
