import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { BridgeKit, type EVMChainDefinition } from "@circle-fin/bridge-kit";
import type { Network } from "@x402/core/types";
import { config } from "../config.js";

type ChainStatus = "active" | "degraded" | "paused";

export interface FacilitatorChain {
  network: Network;
  chainId: number;
  chainName: string;
  displayName: string;
  usdcAddress: `0x${string}`;
  rpcEndpoints: string[];
  explorerUrl?: string;
  isTestnet: boolean;
  status: ChainStatus;
}

const isValidStatus = (value: unknown): value is ChainStatus =>
  value === "active" || value === "degraded" || value === "paused";

const normalizeStatus = (value: unknown, fallback: ChainStatus = "active"): ChainStatus => {
  const text = String(value || "").trim().toLowerCase();
  return isValidStatus(text) ? text : fallback;
};

const toChainAddress = (value: string): `0x${string}` => value as `0x${string}`;

export class FacilitatorChainCatalog {
  private readonly kit = new BridgeKit();
  private readonly statusByNetwork = new Map<Network, ChainStatus>();
  private chains: FacilitatorChain[] = [];

  constructor(
    private readonly statusFilePath: string = config.CHAIN_STATUS_FILE,
    private readonly statusOverrides: Record<string, string> = config.CHAIN_STATUS_OVERRIDES_JSON
  ) {
    this.loadStatuses();
  }

  private ensureParentDir(): void {
    const parent = dirname(this.statusFilePath);
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true });
    }
  }

  private loadStatuses(): void {
    this.statusByNetwork.clear();
    this.ensureParentDir();

    if (existsSync(this.statusFilePath)) {
      try {
        const raw = readFileSync(this.statusFilePath, "utf8");
        const parsed = JSON.parse(raw) as Record<string, string>;
        Object.entries(parsed).forEach(([network, status]) => {
          this.statusByNetwork.set(network as Network, normalizeStatus(status));
        });
      } catch (error) {
        console.warn("[facilitator] failed to load chain status file", {
          error: error instanceof Error ? error.message : String(error),
          path: this.statusFilePath
        });
      }
    }

    Object.entries(this.statusOverrides || {}).forEach(([network, status]) => {
      this.statusByNetwork.set(network as Network, normalizeStatus(status));
    });
  }

  private saveStatuses(): void {
    this.ensureParentDir();
    const payload = Object.fromEntries(this.statusByNetwork.entries());
    writeFileSync(this.statusFilePath, JSON.stringify(payload, null, 2), "utf8");
  }

  sync(): FacilitatorChain[] {
    this.loadStatuses();

    const evmChains = this.kit.getSupportedChains({ chainType: "evm" });
    const next: FacilitatorChain[] = [];

    evmChains
      .filter((chain): chain is EVMChainDefinition => chain.type === "evm")
      .forEach((chain) => {
        const usdcAddress = String(chain.usdcAddress || "").trim();
        if (!/^0x[a-fA-F0-9]{40}$/.test(usdcAddress)) {
          return;
        }

        const network = `eip155:${chain.chainId}` as Network;
        const persistedStatus = this.statusByNetwork.get(network);
        const status = normalizeStatus(persistedStatus || "active");
        const rpcEndpoints = Array.isArray(chain.rpcEndpoints)
          ? chain.rpcEndpoints.filter((url) => typeof url === "string" && /^https?:\/\//.test(url))
          : [];

        next.push({
          network,
          chainId: chain.chainId,
          chainName: String(chain.chain || chain.name || network),
          displayName: String(chain.name || chain.title || chain.chain || network),
          usdcAddress: toChainAddress(usdcAddress),
          rpcEndpoints,
          explorerUrl: typeof chain.explorerUrl === "string" ? chain.explorerUrl : undefined,
          isTestnet: Boolean(chain.isTestnet),
          status
        });
      });

    this.chains = next.sort((a, b) => a.chainId - b.chainId);
    return this.chains;
  }

  list(): FacilitatorChain[] {
    if (!this.chains.length) {
      return this.sync();
    }
    return this.chains;
  }

  activeNetworks(): Network[] {
    return this.list()
      .filter((chain) => chain.status !== "paused")
      .map((chain) => chain.network);
  }

  isPaused(network: Network): boolean {
    const chain = this.list().find((item) => item.network === network);
    return chain?.status === "paused";
  }

  setStatus(network: Network, status: ChainStatus): FacilitatorChain | null {
    this.statusByNetwork.set(network, normalizeStatus(status));
    this.saveStatuses();
    const chains = this.sync();
    return chains.find((item) => item.network === network) || null;
  }
}
