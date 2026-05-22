# RailBridge Testnet Deployment (Shared VPS + Traefik)

This folder contains the deployment assets for the `app/api/facilitator.testnet.railbridge.ai` rollout.

## Scope

- `railbridge-landing` stays on Vercel (out of this stack).
- `merchant-os` frontend/API and `facilitator` run on the VPS as a separate Docker Compose project.
- Traefik is the only ingress binding `80/443`.

## Local vs Server Config Policy

- Keep local development configs only on your local machine.
- Keep testnet deployment configs only on the VPS.
- Never copy local config files to the VPS.
- Never copy VPS testnet secrets/configs back to local.

## Testnet Config Source Naming

Place the following files on the VPS config directory (default: `/opt/railbridge-config/testnet`):

- `merchant-os.testnet.env`
- `merchant-web.testnet.env`
- `facilitator.testnet.env`
- `merchant-os.runtime-config.testnet.json`
- `facilitator.runtime-config.testnet.json`

Use `deploy/testnet/config/*.example` as templates.

Bootstrap example:

```bash
mkdir -p /opt/railbridge-config/testnet
cp deploy/testnet/config/merchant-os.testnet.env.example /opt/railbridge-config/testnet/merchant-os.testnet.env
cp deploy/testnet/config/merchant-web.testnet.env.example /opt/railbridge-config/testnet/merchant-web.testnet.env
cp deploy/testnet/config/facilitator.testnet.env.example /opt/railbridge-config/testnet/facilitator.testnet.env
cp deploy/testnet/config/merchant-os.runtime-config.testnet.json.example /opt/railbridge-config/testnet/merchant-os.runtime-config.testnet.json
cp deploy/testnet/config/facilitator.runtime-config.testnet.json.example /opt/railbridge-config/testnet/facilitator.runtime-config.testnet.json
```

## Runtime Mapping (Required)

The app code expects fixed runtime filenames. Run:

```bash
./deploy/testnet/prepare-testnet-runtime-configs.sh /opt/railbridge-config/testnet
```

Mapping performed by the script:

- `merchant-os.testnet.env` -> `merchant-os/.env`
- `merchant-os.runtime-config.testnet.json` -> `merchant-os/config/runtime-config.local.json`
- `merchant-web.testnet.env` -> `merchant-os/frontend/.env.production`
- `facilitator.testnet.env` -> `facilitator/.env`
- `facilitator.runtime-config.testnet.json` -> `facilitator/config/runtime-config.local.json`

## Deploy

```bash
docker compose \
  -f deploy/testnet/docker-compose.testnet.yml \
  --project-name railbridge-testnet \
  up -d --build --remove-orphans
```

Optional preflight:

```bash
./deploy/testnet/preflight-shared-vps.sh traefik-public
```

## GitHub Actions Secrets

Workflow: `.github/workflows/deploy-testnet.yml`

Required:

- `TESTNET_VPS_HOST`
- `TESTNET_VPS_USER`
- `TESTNET_VPS_SSH_KEY`
- `TESTNET_APP_DIR` (absolute path to repo on VPS)
- `TESTNET_CONFIG_DIR` (absolute path to `*.testnet.env` + `*.runtime-config.testnet.json` files on VPS)

Optional:

- `TRAEFIK_NETWORK` (default `traefik-public`)
- `TRAEFIK_ENTRYPOINT` (default `websecure`)
- `TRAEFIK_CERT_RESOLVER` (default `letsencrypt`)
- `TESTNET_APP_HOST` (default `app.testnet.railbridge.ai`)
- `TESTNET_API_HOST` (default `api.testnet.railbridge.ai`)
- `TESTNET_FACILITATOR_HOST` (default `facilitator.testnet.railbridge.ai`)
- `TESTNET_MERCHANT_OS_DATA_DIR` (default `/data/railbridge/merchant-os`)
- `TESTNET_FACILITATOR_DATA_DIR` (default `/data/railbridge/facilitator`)

Note: workflow currently assumes SSH port `22`. If your VPS SSH port differs, update the workflow `port` field.

## Required Environment Notes

- Set `NODE_ENV=production` for deployed services.
- Optional: `RAILBRIDGE_ENV=testnet` for labeling.
- `MERCHANT_OS_INGEST_TOKEN` in facilitator env must match Merchant OS ingest token.
- Non-secret operational settings belong in `runtime-config.local.json`, not deprecated facilitator env keys.

## DNS and Hostnames

Point Namecheap records to the VPS IP:

- `app.testnet.railbridge.ai`
- `api.testnet.railbridge.ai`
- `facilitator.testnet.railbridge.ai`

## Existing App Coexistence

- Keep existing app behind Traefik host rules.
- Do not expose app containers directly on `80/443`.
- Ensure the shared Traefik network exists (`traefik-public` by default).
