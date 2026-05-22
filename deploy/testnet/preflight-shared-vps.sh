#!/usr/bin/env bash

set -euo pipefail

TRAEFIK_NETWORK="${1:-${TRAEFIK_NETWORK:-traefik-public}}"

echo "[preflight] Checking Docker availability..."
docker version >/dev/null

echo "[preflight] Checking shared Traefik network: ${TRAEFIK_NETWORK}"
docker network inspect "${TRAEFIK_NETWORK}" >/dev/null 2>&1 || {
  echo "Missing Docker network '${TRAEFIK_NETWORK}'."
  exit 1
}

echo "[preflight] Containers publishing host ports 80/443:"
docker ps --format '{{.Names}}\t{{.Ports}}' | grep -E '(:80->|:443->)' || true

echo "[preflight] Done. Ensure Traefik is the only container intended to publish 80/443."

