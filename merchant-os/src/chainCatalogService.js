import { BridgeKit } from "@circle-fin/bridge-kit";
import { config } from "./config.js";
import {
  getChainCatalogRuntimeMaps,
  listChainCatalog,
  setChainCatalogStatus,
  upsertChainCatalogRows
} from "./db.js";

const VALID_STATUS = new Set(["active", "degraded", "paused"]);

const resolveStatus = ({ network, existingStatus, overrideStatus }) => {
  const override = String(overrideStatus || "").trim().toLowerCase();
  if (VALID_STATUS.has(override)) {
    return override;
  }
  if (VALID_STATUS.has(existingStatus)) {
    return existingStatus;
  }
  return "active";
};

export class ChainCatalogService {
  constructor() {
    this.kit = new BridgeKit();
    this.timer = null;
  }

  refreshRuntimeMaps() {
    const runtimeMaps = getChainCatalogRuntimeMaps();
    config.applyChainRuntimeMaps(runtimeMaps);
    return runtimeMaps;
  }

  syncNow() {
    const now = new Date().toISOString();
    const existing = new Map(
      listChainCatalog().map((row) => [row.network, row])
    );

    const evmChains = this.kit
      .getSupportedChains({ chainType: "evm" })
      .filter((chain) => chain?.type === "evm");

    const rows = [];
    evmChains.forEach((chain) => {
      const usdcAddress = String(chain.usdcAddress || "").trim();
      if (!/^0x[a-fA-F0-9]{40}$/.test(usdcAddress)) {
        return;
      }
      const network = `eip155:${chain.chainId}`;
      const existingRow = existing.get(network);
      const overrideStatus = config.chainStatusOverrides?.[network];
      const status = resolveStatus({
        network,
        existingStatus: existingRow?.status,
        overrideStatus
      });
      const rpcEndpoints = Array.isArray(chain.rpcEndpoints)
        ? chain.rpcEndpoints.filter((url) => typeof url === "string" && /^https?:\/\//.test(url))
        : [];

      rows.push({
        network,
        chainName: String(chain.chain || chain.name || network),
        displayName: String(chain.name || chain.title || chain.chain || network),
        chainType: "evm",
        usdcAddress,
        rpcEndpoints,
        explorerUrl: String(chain.explorerUrl || "").trim() || null,
        status,
        source: "circle_bridge_kit",
        sourceUpdatedAt: now
      });
    });

    upsertChainCatalogRows(rows);
    return this.refreshRuntimeMaps();
  }

  setStatus(network, status) {
    setChainCatalogStatus(network, status);
    return this.refreshRuntimeMaps();
  }

  listChains() {
    return listChainCatalog();
  }

  start() {
    this.syncNow();
    if (this.timer) {
      clearInterval(this.timer);
    }
    const intervalMs = Math.max(10000, Number(config.chainCatalogSyncMs || 300000));
    this.timer = setInterval(() => {
      try {
        this.syncNow();
      } catch (error) {
        console.warn("[merchant-os] chain catalog sync failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }, intervalMs);
    this.timer.unref?.();
  }
}
