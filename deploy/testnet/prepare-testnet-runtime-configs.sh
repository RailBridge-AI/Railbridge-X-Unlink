#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CONFIG_ROOT="${1:-${RAILBRIDGE_TESTNET_CONFIG_DIR:-${REPO_ROOT}/deploy/testnet/config}}"

require_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "Missing required config file: $path" >&2
    exit 1
  fi
}

copy_env() {
  local src="$1"
  local dst="$2"
  install -d "$(dirname "$dst")"
  install -m 600 "$src" "$dst"
}

copy_json() {
  local src="$1"
  local dst="$2"
  install -d "$(dirname "$dst")"
  install -m 644 "$src" "$dst"
}

require_file "${CONFIG_ROOT}/merchant-os.testnet.env"
require_file "${CONFIG_ROOT}/merchant-web.testnet.env"
require_file "${CONFIG_ROOT}/facilitator.testnet.env"
require_file "${CONFIG_ROOT}/merchant-os.runtime-config.testnet.json"
require_file "${CONFIG_ROOT}/facilitator.runtime-config.testnet.json"

copy_env \
  "${CONFIG_ROOT}/merchant-os.testnet.env" \
  "${REPO_ROOT}/merchant-os/.env"

copy_json \
  "${CONFIG_ROOT}/merchant-os.runtime-config.testnet.json" \
  "${REPO_ROOT}/merchant-os/config/runtime-config.local.json"

copy_env \
  "${CONFIG_ROOT}/merchant-web.testnet.env" \
  "${REPO_ROOT}/merchant-os/frontend/.env.production"

copy_env \
  "${CONFIG_ROOT}/facilitator.testnet.env" \
  "${REPO_ROOT}/facilitator/.env"

copy_json \
  "${CONFIG_ROOT}/facilitator.runtime-config.testnet.json" \
  "${REPO_ROOT}/facilitator/config/runtime-config.local.json"

echo "Prepared runtime testnet config files from: ${CONFIG_ROOT}"
echo "- merchant-os/.env"
echo "- merchant-os/config/runtime-config.local.json"
echo "- merchant-os/frontend/.env.production"
echo "- facilitator/.env"
echo "- facilitator/config/runtime-config.local.json"

