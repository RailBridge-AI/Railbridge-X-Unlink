import { config } from "../config.js";
import {
  createPaymentRequirementContext,
  getApiProductByApiId,
  getApiProductById,
  getApiProductByMethodPath,
  getChainCatalogByNetwork,
  getChainCatalogRuntimeMaps,
  getPolicy,
  getWalletByNetwork,
  getWallets
} from "../db.js";
import {
  isSourceNetworkAny,
  isUsdcAsset,
  resolveUsdcDomainProfile
} from "./usdcRoutingService.js";

const PRIVATE_TREASURY_MVP_NETWORK = "eip155:84532";

const normalizeTreasuryMode = (value) =>
  String(value || "").trim().toLowerCase() === "private" ? "private" : "public";

const isValidPlatformAddress = (value) =>
  typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value.trim());

const computePrivacyRouting = ({
  treasuryMode,
  privateHomeNetwork,
  sourceNetwork,
  effectiveSettlementMode
}) => {
  if (treasuryMode !== "private") {
    return {
      treasuryMode: "public",
      privacyCoverageMode: null,
      privateRoutingEnabled: false
    };
  }

  const fullPrivate =
    effectiveSettlementMode === "same_chain" &&
    privateHomeNetwork === PRIVATE_TREASURY_MVP_NETWORK &&
    sourceNetwork === PRIVATE_TREASURY_MVP_NETWORK &&
    isValidPlatformAddress(config.facilitatorAddress);

  return {
    treasuryMode: "private",
    privacyCoverageMode: fullPrivate ? "full_private" : "public_fallback",
    privateRoutingEnabled: fullPrivate
  };
};

export const resolvePaymentRequirementsForTenant = ({
  merchantId,
  accountId,
  apiProductId = "",
  apiId = "",
  routeMethod = "GET",
  routePath = "/api/premium",
  settlementModeOverride = null
}) => {
  if (!merchantId || !accountId) {
    return {
      status: 400,
      payload: { error: "merchantId and accountId are required" }
    };
  }
  if (!getWallets(merchantId, accountId).length) {
    return {
      status: 404,
      payload: { error: "Merchant account not found" }
    };
  }

  const apiProduct = apiProductId
    ? getApiProductById(merchantId, accountId, apiProductId)
    : apiId
      ? getApiProductByApiId(merchantId, accountId, apiId)
      : getApiProductByMethodPath(merchantId, accountId, routeMethod, routePath);

  if (!apiProduct || !apiProduct.enabled) {
    return {
      status: 404,
      payload: { error: "API product not found or disabled" }
    };
  }

  if (
    settlementModeOverride &&
    settlementModeOverride !== "same_chain" &&
    settlementModeOverride !== "cross_chain"
  ) {
    return {
      status: 400,
      payload: { error: "settlementModeOverride must be same_chain or cross_chain" }
    };
  }

  const effectiveSettlementMode = settlementModeOverride || apiProduct.settlementMode;
  const runtimeMaps = getChainCatalogRuntimeMaps();
  const walletRows = getWallets(merchantId, accountId).filter(
    (wallet) => String(wallet.asset || "").toUpperCase() === "USDC"
  );
  const walletByNetwork = new Map(walletRows.map((wallet) => [wallet.network, wallet]));
  const activeChainByNetwork = new Map((runtimeMaps.chains || []).map((chain) => [chain.network, chain]));

  let sourceCandidates = [];
  if (isSourceNetworkAny(apiProduct.sourceNetwork)) {
    sourceCandidates = (runtimeMaps.chains || [])
      .filter((chain) => walletByNetwork.has(chain.network))
      .map((chain) => ({
        network: chain.network,
        wallet: walletByNetwork.get(chain.network),
        chain
      }));
    if (!sourceCandidates.length) {
      sourceCandidates = walletRows
        .map((wallet) => ({
          network: wallet.network,
          wallet,
          chain: getChainCatalogByNetwork(wallet.network)
        }))
        .filter((candidate) => candidate.chain?.status !== "paused");
    }
  } else {
    const sourceWallet = getWalletByNetwork(merchantId, accountId, apiProduct.sourceNetwork);
    if (!sourceWallet) {
      return {
        status: 400,
        payload: { error: "source network wallet not found for merchant account" }
      };
    }
    const sourceChain =
      activeChainByNetwork.get(apiProduct.sourceNetwork) || getChainCatalogByNetwork(apiProduct.sourceNetwork);
    if (sourceChain?.status === "paused") {
      return {
        status: 400,
        payload: { error: "source network is paused by RailBridge operations" }
      };
    }
    sourceCandidates = [
      {
        network: apiProduct.sourceNetwork,
        wallet: sourceWallet,
        chain: sourceChain
      }
    ];
  }

  if (!sourceCandidates.length) {
    return {
      status: 400,
      payload: { error: "no active source networks available for this merchant account" }
    };
  }

  let payTo = null;
  let crossChain = null;
  const policy = getPolicy(merchantId, accountId);
  const treasuryMode = normalizeTreasuryMode(policy?.treasuryMode);
  const privateHomeNetwork = String(policy?.privateHomeNetwork || "").trim() || null;
  const policyPreferredNetwork = String(policy?.preferredNetwork || "").trim();
  const usePolicySameChainDefault =
    effectiveSettlementMode === "cross_chain" &&
    !apiProduct.destinationNetwork &&
    policyPreferredNetwork === "same_chain";
  if (effectiveSettlementMode === "cross_chain") {
    if (usePolicySameChainDefault) {
      payTo = null;
      crossChain = null;
    } else {
    const destinationNetwork =
      apiProduct.destinationNetwork ||
      policyPreferredNetwork ||
      sourceCandidates[0]?.network;
    if (!destinationNetwork) {
      return {
        status: 400,
        payload: { error: "destination network is required for cross-chain product" }
      };
    }
    const destinationWallet = getWalletByNetwork(merchantId, accountId, destinationNetwork);
    if (!destinationWallet) {
      return {
        status: 400,
        payload: { error: "destination wallet not found for cross-chain product" }
      };
    }
    const destinationChain = getChainCatalogByNetwork(destinationNetwork);
    if (destinationChain?.status === "paused") {
      return {
        status: 400,
        payload: { error: "destination network is paused by RailBridge operations" }
      };
    }
    const destinationAsset = String(
      apiProduct.destinationAsset || destinationChain?.usdcAddress || "USDC"
    ).trim();
    if (!destinationAsset || !isUsdcAsset(destinationAsset)) {
      return {
        status: 400,
        payload: { error: "destination asset is invalid or not in USDC allowlist" }
      };
    }
    if (!config.facilitatorAddress || !/^0x[a-fA-F0-9]{40}$/.test(config.facilitatorAddress)) {
      return {
        status: 500,
        payload: {
          error: "MERCHANT_OS_FACILITATOR_ADDRESS is required for cross-chain requirement resolution"
        }
      };
    }
    payTo = config.facilitatorAddress;
    crossChain = {
      destinationNetwork,
      destinationAsset,
      destinationPayTo: destinationWallet.address
    };
    }
  }
  const shouldRouteViaFacilitator = effectiveSettlementMode === "cross_chain" && Boolean(crossChain) && Boolean(payTo);

  const description = apiProduct.description || `${apiProduct.apiName} (${apiProduct.method} ${apiProduct.path})`;
  const requirements = sourceCandidates.map((candidate) => {
    const preferredSourceAsset = String(candidate.chain?.usdcAddress || apiProduct.sourceAsset || "USDC").trim();
    const sourceAsset = isUsdcAsset(preferredSourceAsset) ? preferredSourceAsset : "USDC";
    const sourceDomain = resolveUsdcDomainProfile(candidate.network);
    const privacyRouting = computePrivacyRouting({
      treasuryMode,
      privateHomeNetwork,
      sourceNetwork: candidate.network,
      effectiveSettlementMode
    });
    const resolvedPayTo =
      privacyRouting.privateRoutingEnabled
        ? config.facilitatorAddress
        : shouldRouteViaFacilitator
          ? payTo
          : candidate.wallet.address;
    const priceExtra = {
      name: sourceDomain.name,
      version: sourceDomain.version,
      apiId: apiProduct.apiId,
      apiName: apiProduct.apiName,
      method: apiProduct.method,
      route: apiProduct.path
    };
    const requirementExtra = {
      apiId: apiProduct.apiId,
      apiName: apiProduct.apiName,
      method: apiProduct.method,
      route: apiProduct.path,
      description
    };

    if (privacyRouting.treasuryMode === "private") {
      const paymentContext = createPaymentRequirementContext({
        merchantId,
        accountId,
        apiProductId: apiProduct.id,
        treasuryMode: privacyRouting.treasuryMode,
        privacyCoverageMode: privacyRouting.privacyCoverageMode,
        privateHomeNetwork,
        scheme: "exact",
        sourceNetwork: candidate.network,
        destinationNetwork: crossChain?.destinationNetwork || null,
        asset: sourceAsset,
        amount: apiProduct.amount,
        publicPayTo: resolvedPayTo,
        metadata: {
          apiId: apiProduct.apiId,
          apiName: apiProduct.apiName,
          routeMethod: apiProduct.method,
          routePath: apiProduct.path,
          settlementMode: privacyRouting.privateRoutingEnabled ? "private_intake" : "public_fallback"
        }
      });

      return {
        scheme: "exact",
        network: candidate.network,
        price: {
          asset: sourceAsset,
          amount: apiProduct.amount,
          extra: priceExtra
        },
        payTo: resolvedPayTo,
        extra: {
          ...requirementExtra,
          rbPrivacy: {
            treasuryMode: privacyRouting.treasuryMode,
            privacyCoverageMode: privacyRouting.privacyCoverageMode,
            paymentContextId: paymentContext.paymentContextId,
            privateHomeNetwork
          }
        }
      };
    }

    return {
      scheme: "exact",
      network: candidate.network,
      price: {
        asset: sourceAsset,
        amount: apiProduct.amount,
        extra: {
          ...priceExtra,
          merchantId,
          accountId
        }
      },
      payTo: resolvedPayTo,
      extra: {
        ...requirementExtra,
        merchantId,
        accountId
      }
    };
  });

  if (!requirements.length) {
    return {
      status: 400,
      payload: { error: "no valid requirement options for this product" }
    };
  }

  return {
    status: 200,
    payload: {
      merchantId,
      accountId,
      settlementMode: shouldRouteViaFacilitator ? "cross_chain" : "same_chain",
      apiProduct,
      requirement: requirements[0],
      requirements,
      crossChain
    }
  };
};
