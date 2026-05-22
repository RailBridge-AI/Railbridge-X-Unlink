import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildBridgeKitGasEstimateMap,
  collectRpcUrlsForBridgeChain,
  extractBridgeKitRpcUrls,
  parseEstimatedGasFeeWei,
  resolveBridgeKitChainCaip2
} from "../../src/consolidationBridgeService.js";

describe("Consolidation bridge RPC resolution", () => {
  test("resolveBridgeKitChainCaip2 uses Bridge Kit chainId", () => {
    assert.equal(resolveBridgeKitChainCaip2({ chainId: 421614 }), "eip155:421614");
    assert.equal(resolveBridgeKitChainCaip2({ chainId: 84532 }), "eip155:84532");
    assert.equal(resolveBridgeKitChainCaip2({ id: 1 }), "eip155:1");
    assert.equal(resolveBridgeKitChainCaip2({}), null);
  });

  test("extractBridgeKitRpcUrls reads rpcEndpoints from Bridge Kit chain", () => {
    assert.deepEqual(
      extractBridgeKitRpcUrls({
        chainId: 84532,
        rpcEndpoints: ["https://sepolia.base.org"]
      }),
      ["https://sepolia.base.org"]
    );
  });

  test("collectRpcUrlsForBridgeChain prioritizes Bridge Kit RPC before config overrides", () => {
    const urls = collectRpcUrlsForBridgeChain(
      {
        chainId: 421614,
        rpcEndpoints: ["https://sepolia-rollup.arbitrum.io/rpc"]
      },
      {
        rpcUrlsByNetwork: {
          "eip155:421614": ["https://arbitrum-sepolia-rpc.publicnode.com"]
        }
      },
      {
        bridgeKitRpcUrls: ["https://sepolia-rollup.arbitrum.io/rpc"]
      }
    );

    assert.equal(urls[0], "https://sepolia-rollup.arbitrum.io/rpc");
    assert.ok(urls.includes("https://arbitrum-sepolia-rpc.publicnode.com"));
    assert.ok(urls.length >= 2);
  });
});

describe("Consolidation bridge gas estimation helpers", () => {
  test("parseEstimatedGasFeeWei prefers explicit fee string", () => {
    assert.equal(
      parseEstimatedGasFeeWei({
        fee: "123456",
        gas: 1n,
        gasPrice: 2n
      }),
      123456n
    );
  });

  test("parseEstimatedGasFeeWei falls back to gas * gasPrice", () => {
    assert.equal(
      parseEstimatedGasFeeWei({
        gas: 21000n,
        gasPrice: 2_000_000_000n
      }),
      42_000_000_000_000n
    );
  });

  test("buildBridgeKitGasEstimateMap groups and sums fees by network", () => {
    const map = buildBridgeKitGasEstimateMap({
      gasFees: [
        {
          name: "approve",
          token: "ETH",
          blockchain: { chainId: 84532 },
          fees: { fee: "100" }
        },
        {
          name: "burn",
          token: "ETH",
          blockchain: { chainId: 84532 },
          fees: { gas: 20n, gasPrice: 5n }
        },
        {
          name: "mint",
          token: "ETH",
          blockchain: { chainId: 421614 },
          fees: { fee: "55" }
        }
      ],
      resolveNetwork: (blockchain) =>
        Number.isInteger(blockchain?.chainId) ? `eip155:${blockchain.chainId}` : null
    });

    assert.equal(map.get("eip155:84532")?.estimatedFeeWei, 200n);
    assert.deepEqual(map.get("eip155:84532")?.stepNames, ["approve", "burn"]);
    assert.equal(map.get("eip155:421614")?.estimatedFeeWei, 55n);
    assert.equal(map.get("eip155:421614")?.tokenSymbol, "ETH");
  });
});
