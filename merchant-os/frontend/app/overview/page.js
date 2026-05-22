"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import BridgeTransferProgress from "../../components/console/BridgeTransferProgress";
import PlatformShell from "../../components/console/PlatformShell";
import { apiWithMerchantKey } from "../../lib/platformClient";
import { mapChainsByNetwork } from "../../lib/explorerLinks";
import { useAuthGuard } from "../../lib/useAuthGuard";
import {
  compareNetworksForDisplay,
  formatUsdcBaseUnits,
  getNetworkInfo,
  getTokenInfo,
  isTestnetNetwork,
  shouldPreferTestnetsInUi
} from "../../lib/assetDisplay";

const defaultBridgeForm = {
  sourceNetwork: "",
  destinationNetwork: "",
  amountUsdc: "0"
};

const parseBaseUnitsSafe = (value) => {
  try {
    return BigInt(String(value || "0"));
  } catch {
    return 0n;
  }
};

const parseUsdcInputToBaseUnits = (value) => {
  const text = String(value || "").trim();
  if (!/^\d+(\.\d{1,6})?$/.test(text)) {
    return null;
  }
  const [wholeRaw, fractionRaw = ""] = text.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  const fraction = `${fractionRaw}000000`.slice(0, 6);
  try {
    return BigInt(whole) * 1_000_000n + BigInt(fraction);
  } catch {
    return null;
  }
};

const baseUnitsToUsdcInput = (value) => {
  const text = String(value || "0").replace(/[^0-9]/g, "");
  if (!text) {
    return "0";
  }
  const padded = text.padStart(7, "0");
  const whole = padded.slice(0, -6).replace(/^0+(?=\d)/, "");
  const fraction = padded.slice(-6).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
};

const formatNativeWei = (value) => {
  try {
    const amount = BigInt(String(value || "0"));
    const integer = amount / 1_000_000_000_000_000_000n;
    const fraction = amount % 1_000_000_000_000_000_000n;
    if (fraction === 0n) {
      return integer.toString();
    }
    let fractionText = fraction.toString().padStart(18, "0").replace(/0+$/, "");
    if (fractionText.length > 6) {
      fractionText = fractionText.slice(0, 6);
    }
    return `${integer}.${fractionText}`;
  } catch {
    return "0";
  }
};

const recommendationTone = (level) => {
  switch (level) {
    case "good":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "caution":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "warning":
      return "border-rose-200 bg-rose-50 text-rose-800";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
};

const balancesAreLive = (payload) =>
  Boolean(payload?.onchainMode && payload.onchainMode !== "skip");

const BalanceSkeleton = ({ variant = "light", className = "" }) => {
  const tone = variant === "dark" ? "bg-white/25" : "bg-slate-200";
  return (
    <span
      className={`inline-block animate-pulse rounded-md ${tone} ${className}`}
      role="status"
      aria-label="Loading balance"
    />
  );
};

const UsdAmount = ({
  value,
  ready,
  className = "",
  skeletonClassName = "h-4 w-16",
  skeletonVariant = "light"
}) => {
  if (!ready) {
    return <BalanceSkeleton variant={skeletonVariant} className={skeletonClassName} />;
  }
  return <span className={className}>${value || "0.00"}</span>;
};

const UsdcAmount = ({
  value,
  ready,
  symbol = "USDC",
  className = "",
  skeletonClassName = "h-3.5 w-20",
  skeletonVariant = "light"
}) => {
  if (!ready) {
    return <BalanceSkeleton variant={skeletonVariant} className={skeletonClassName} />;
  }
  return (
    <span className={className}>
      {value} {symbol}
    </span>
  );
};

const NetworkBalanceRowSkeleton = () => (
  <article className="rounded-xl border border-slate-200 bg-white p-3">
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <BalanceSkeleton className="h-9 w-9 shrink-0 rounded-full" />
        <BalanceSkeleton className="h-4 w-32 max-w-[60%]" />
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <BalanceSkeleton className="h-4 w-16" />
        <BalanceSkeleton className="h-3.5 w-24" />
      </div>
    </div>
  </article>
);

const OverviewBalancesSkeleton = ({ networkRows = 6 }) => (
  <div className="space-y-4" aria-busy="true" aria-label="Loading balances">
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-rail-800 p-5 text-white shadow-panel">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(255,255,255,0.18),transparent_40%)]"></div>
      <div className="relative z-10">
        <BalanceSkeleton variant="dark" className="h-3 w-28" />
        <BalanceSkeleton variant="dark" className="mt-3 h-10 w-44" />
        <BalanceSkeleton variant="dark" className="mt-3 h-4 w-56" />
        <BalanceSkeleton variant="dark" className="mt-2 h-4 w-40" />
      </div>
    </section>

    <section className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
      <BalanceSkeleton className="h-5 w-44" />
      <div className="mt-2 h-[420px] overflow-y-auto pr-1">
        <div className="grid gap-2">
          {Array.from({ length: networkRows }, (_, index) => (
            <NetworkBalanceRowSkeleton key={`network-balance-skeleton-${index}`} />
          ))}
        </div>
      </div>
    </section>
  </div>
);

const BridgeNetworkOptionIcon = ({ network }) => {
  const networkInfo = getNetworkInfo(network);
  if (networkInfo.logo) {
    return (
      <img
        src={networkInfo.logo}
        alt=""
        className="h-5 w-5 rounded-full object-contain"
      />
    );
  }

  const initials = String(networkInfo.name || network || "N")
    .trim()
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-[10px] font-semibold text-slate-700">
      {initials}
    </span>
  );
};

const BALANCE_REFRESH_MS = 20000;
const BRIDGE_POLL_MS = 3000;
const BRIDGE_POLL_MAX_ATTEMPTS = 120;
const BRIDGE_PREFLIGHT_STEP_MS = 5000;
const BRIDGE_REFRESH_TIMEOUT_MS = 10000;

const bridgeSubmitButtonLabel = (flow) => {
  if (!flow || flow.phase === "idle") {
    return "Move funds";
  }
  if (flow.phase === "preflight") {
    const labels = [
      "Checking USDC balance…",
      "Checking gas…",
      "Estimating bridge fees…",
      "Gas top-up…",
      "Queueing transfer…"
    ];
    return labels[Math.min(flow.preflightStepIndex, labels.length - 1)] || "Running preflight…";
  }
  if (flow.phase === "bridging" || flow.phase === "refreshing") {
    return "Bridge in progress…";
  }
  return "Move funds";
};

const bridgeFlowIsActive = (flow) =>
  Boolean(flow?.phase && flow.phase !== "idle" && flow.phase !== "confirmed" && flow.phase !== "failed");

export default function OverviewPage() {
  const { auth, logout } = useAuthGuard();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [bridgeForm, setBridgeForm] = useState(defaultBridgeForm);
  const [bridgeFlow, setBridgeFlow] = useState(null);
  const [chainsByNetwork, setChainsByNetwork] = useState({});
  const [bridgeEstimate, setBridgeEstimate] = useState(null);
  const [bridgeEstimateBusy, setBridgeEstimateBusy] = useState(false);
  const [bridgeEstimateError, setBridgeEstimateError] = useState("");
  const [showTestnetsOnly, setShowTestnetsOnly] = useState(false);
  const [sourceDropdownOpen, setSourceDropdownOpen] = useState(false);
  const [destinationDropdownOpen, setDestinationDropdownOpen] = useState(false);
  const sourceDropdownRef = useRef(null);
  const destinationDropdownRef = useRef(null);
  const refreshRequestIdRef = useRef(0);
  const balancesReady = balancesAreLive(data);

  const balancesByNetwork = useMemo(
    () =>
      (data?.balances || []).reduce((map, item) => {
        if (item?.network) {
          map[item.network] = item;
        }
        return map;
      }, {}),
    [data]
  );

  const sortedBalances = useMemo(() => {
    const balances = Array.isArray(data?.balances) ? data.balances : [];
    const visibleBalances = showTestnetsOnly
      ? balances.filter((item) => isTestnetNetwork(item?.network))
      : balances;
    return [...visibleBalances].sort((left, right) =>
      compareNetworksForDisplay(left.network, right.network)
    );
  }, [data, showTestnetsOnly]);

  const sourceAvailableBaseUnits = parseBaseUnitsSafe(
    balancesByNetwork[bridgeForm.sourceNetwork]?.amount || "0"
  );
  const sourceAvailableUsdc = baseUnitsToUsdcInput(sourceAvailableBaseUnits.toString());
  const requestedBridgeBaseUnits = parseUsdcInputToBaseUnits(bridgeForm.amountUsdc);
  const insufficientSourceBalance =
    requestedBridgeBaseUnits !== null &&
    bridgeForm.sourceNetwork &&
    requestedBridgeBaseUnits > sourceAvailableBaseUnits;

  const networkOptions = useMemo(() => {
    if (!sortedBalances.length) {
      return [];
    }
    return [...new Set(sortedBalances.map((item) => item.network).filter(Boolean))];
  }, [sortedBalances]);

  const sourceNetworkOptions = useMemo(() => {
    if (!sortedBalances.length) {
      return [];
    }
    return sortedBalances
      .filter((item) => {
        try {
          return BigInt(String(item.amount || "0")) > 0n;
        } catch {
          return false;
        }
      })
      .map((item) => item.network)
      .filter(Boolean);
  }, [sortedBalances]);

  const destinationOptions = useMemo(() => {
    if (!networkOptions.length) {
      return [];
    }
    const filtered = networkOptions.filter((network) => network !== bridgeForm.sourceNetwork);
    return filtered.length ? filtered : networkOptions;
  }, [networkOptions, bridgeForm.sourceNetwork]);

  const sourceDropdownItems = useMemo(
    () =>
      (sourceNetworkOptions.length ? sourceNetworkOptions : networkOptions).map((network) => ({
        network,
        name: getNetworkInfo(network).name
      })),
    [networkOptions, sourceNetworkOptions]
  );

  const destinationDropdownItems = useMemo(
    () =>
      destinationOptions.map((network) => ({
        network,
        name: getNetworkInfo(network).name
      })),
    [destinationOptions]
  );

  const selectedSourceOption = useMemo(() => {
    if (!sourceDropdownItems.length) {
      return null;
    }
    return sourceDropdownItems.find((item) => item.network === bridgeForm.sourceNetwork) || sourceDropdownItems[0];
  }, [bridgeForm.sourceNetwork, sourceDropdownItems]);

  const selectedDestinationOption = useMemo(() => {
    if (!destinationDropdownItems.length) {
      return null;
    }
    return (
      destinationDropdownItems.find((item) => item.network === bridgeForm.destinationNetwork) ||
      destinationDropdownItems[0]
    );
  }, [bridgeForm.destinationNetwork, destinationDropdownItems]);

  const loadOverview = async (currentAuth, { onchainMode = "priority" } = {}) => {
    const query = onchainMode ? `?onchain=${encodeURIComponent(onchainMode)}` : "";
    return apiWithMerchantKey({
      apiKey: currentAuth.apiKey,
      path: `/v1/merchants/${currentAuth.merchantId}/balances${query}`
    });
  };

  const refreshOverview = async (currentAuth, { onchainMode = "priority", showRefreshing = true } = {}) => {
    const requestId = ++refreshRequestIdRef.current;
    if (showRefreshing) {
      setRefreshing(true);
    }
    try {
      const payload = await loadOverview(currentAuth, { onchainMode });
      if (requestId === refreshRequestIdRef.current) {
        setData(payload);
        setError("");
      }
    } catch (nextError) {
      if (requestId === refreshRequestIdRef.current) {
        setError(nextError.message || "Failed to refresh balances");
      }
    } finally {
      if (showRefreshing && requestId === refreshRequestIdRef.current) {
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    if (!auth) {
      return;
    }
    let cancelled = false;
    setError("");
    setLoading(true);
    setData(null);

    (async () => {
      try {
        const ledgerPayload = await loadOverview(auth, { onchainMode: "skip" });
        if (cancelled) {
          return;
        }
        setData(ledgerPayload);
        setLoading(false);
        setRefreshing(true);
        const livePayload = await loadOverview(auth, { onchainMode: "priority" });
        if (!cancelled) {
          setData(livePayload);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError.message || "Failed to load overview");
          setLoading(false);
        }
      } finally {
        if (!cancelled) {
          setRefreshing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [auth]);

  useEffect(() => {
    if (!auth) {
      return;
    }

    const refreshIfVisible = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      refreshOverview(auth, { onchainMode: "priority", showRefreshing: false });
    };

    const interval = window.setInterval(refreshIfVisible, BALANCE_REFRESH_MS);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [auth]);

  useEffect(() => {
    setShowTestnetsOnly(shouldPreferTestnetsInUi());
  }, []);

  useEffect(() => {
    if (!sourceDropdownOpen && !destinationDropdownOpen) {
      return;
    }

    const handlePointerDown = (event) => {
      const insideSource = sourceDropdownRef.current?.contains(event.target);
      const insideDestination = destinationDropdownRef.current?.contains(event.target);
      if (insideSource || insideDestination) {
        return;
      }
      setSourceDropdownOpen(false);
      setDestinationDropdownOpen(false);
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setSourceDropdownOpen(false);
        setDestinationDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown, { passive: true });
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [destinationDropdownOpen, sourceDropdownOpen]);

  useEffect(() => {
    if (!networkOptions.length) {
      return;
    }
    setBridgeForm((current) => {
      const sourceUniverse = sourceNetworkOptions.length ? sourceNetworkOptions : networkOptions;
      const currentSourceValid = current.sourceNetwork && sourceUniverse.includes(current.sourceNetwork);
      const sourceNetwork = currentSourceValid ? current.sourceNetwork : sourceUniverse[0] || "";
      const candidateDestinations = networkOptions.filter((network) => network !== sourceNetwork);
      const fallbackDestination = candidateDestinations[0] || "";
      const currentDestinationValid =
        current.destinationNetwork &&
        networkOptions.includes(current.destinationNetwork) &&
        current.destinationNetwork !== sourceNetwork;
      const destinationNetwork = currentDestinationValid ? current.destinationNetwork : fallbackDestination;
      return {
        ...current,
        sourceNetwork,
        destinationNetwork
      };
    });
  }, [networkOptions, sourceNetworkOptions]);

  useEffect(() => {
    if (!auth) {
      return;
    }
    if (!bridgeForm.sourceNetwork || !bridgeForm.destinationNetwork) {
      setBridgeEstimate(null);
      setBridgeEstimateError("");
      setBridgeEstimateBusy(false);
      return;
    }
    if (bridgeForm.sourceNetwork === bridgeForm.destinationNetwork) {
      setBridgeEstimate(null);
      setBridgeEstimateError("");
      setBridgeEstimateBusy(false);
      return;
    }
    if (requestedBridgeBaseUnits === null || requestedBridgeBaseUnits <= 0n) {
      setBridgeEstimate(null);
      setBridgeEstimateError("");
      setBridgeEstimateBusy(false);
      return;
    }
    if (requestedBridgeBaseUnits > sourceAvailableBaseUnits) {
      setBridgeEstimate(null);
      setBridgeEstimateError("");
      setBridgeEstimateBusy(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setBridgeEstimateBusy(true);
      setBridgeEstimateError("");
      try {
        const payload = await apiWithMerchantKey({
          apiKey: auth.apiKey,
          path: `/v1/merchants/${auth.merchantId}/consolidations/estimate`,
          method: "POST",
          body: {
            sourceNetwork: bridgeForm.sourceNetwork,
            destinationNetwork: bridgeForm.destinationNetwork,
            amountUsdc: bridgeForm.amountUsdc
          }
        });
        if (!cancelled) {
          setBridgeEstimate(payload);
        }
      } catch (nextError) {
        if (!cancelled) {
          setBridgeEstimate(null);
          setBridgeEstimateError(nextError.message || "Failed to load bridge estimate");
        }
      } finally {
        if (!cancelled) {
          setBridgeEstimateBusy(false);
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    auth,
    bridgeForm.amountUsdc,
    bridgeForm.destinationNetwork,
    bridgeForm.sourceNetwork,
    requestedBridgeBaseUnits,
    sourceAvailableBaseUnits
  ]);

  const bridgeGasFees = Array.isArray(bridgeEstimate?.gasFees) ? bridgeEstimate.gasFees : [];
  const gasTopUpLikely = useMemo(
    () => bridgeGasFees.some((item) => item && item.sufficient === false),
    [bridgeGasFees]
  );

  const dismissBridgeFlow = () => {
    setBridgeFlow(null);
  };

  const fetchConsolidationById = async (currentAuth, consolidationId) => {
    return apiWithMerchantKey({
      apiKey: currentAuth.apiKey,
      path: `/v1/merchants/${currentAuth.merchantId}/consolidations/${encodeURIComponent(consolidationId)}`,
      method: "GET"
    });
  };

  const submitConsolidation = async (event) => {
    event.preventDefault();
    if (!auth) {
      return;
    }
    if (bridgeFlowIsActive(bridgeFlow)) {
      return;
    }

    if (!bridgeForm.sourceNetwork || !bridgeForm.destinationNetwork) {
      setBridgeFlow({
        phase: "failed",
        preflightStepIndex: 0,
        backgroundStepIndex: 0,
        consolidation: null,
        errorMessage: "Select both source and destination networks"
      });
      return;
    }
    if (bridgeForm.sourceNetwork === bridgeForm.destinationNetwork) {
      setBridgeFlow({
        phase: "failed",
        preflightStepIndex: 0,
        backgroundStepIndex: 0,
        consolidation: null,
        errorMessage: "Source and destination networks must differ"
      });
      return;
    }
    if (requestedBridgeBaseUnits === null || requestedBridgeBaseUnits <= 0n) {
      setBridgeFlow({
        phase: "failed",
        preflightStepIndex: 0,
        backgroundStepIndex: 0,
        consolidation: null,
        errorMessage: "Enter a valid USDC amount (up to 6 decimal places)"
      });
      return;
    }
    if (requestedBridgeBaseUnits > sourceAvailableBaseUnits) {
      setBridgeFlow({
        phase: "failed",
        preflightStepIndex: 0,
        backgroundStepIndex: 0,
        consolidation: null,
        errorMessage: `Amount exceeds available balance (${sourceAvailableUsdc} USDC) on selected source network`
      });
      return;
    }

    setBridgeFlow({
      phase: "preflight",
      preflightStepIndex: 0,
      backgroundStepIndex: 0,
      consolidationId: null,
      consolidation: null,
      errorMessage: ""
    });

    try {
      const payload = await apiWithMerchantKey({
        apiKey: auth.apiKey,
        path: `/v1/merchants/${auth.merchantId}/consolidations`,
        method: "POST",
        body: {
          sourceNetwork: bridgeForm.sourceNetwork,
          destinationNetwork: bridgeForm.destinationNetwork,
          amountUsdc: bridgeForm.amountUsdc
        }
      });

      setBridgeFlow({
        phase: "bridging",
        preflightStepIndex: 5,
        backgroundStepIndex: 1,
        consolidationId: payload.id || null,
        consolidation: payload,
        errorMessage: ""
      });
    } catch (nextError) {
      setBridgeFlow({
        phase: "failed",
        preflightStepIndex: 0,
        backgroundStepIndex: 0,
        consolidationId: null,
        consolidation: null,
        errorMessage: nextError.message || "Failed to submit transfer"
      });
    }
  };

  useEffect(() => {
    if (!auth) {
      return;
    }
    let cancelled = false;
    apiWithMerchantKey({
      apiKey: auth.apiKey,
      path: "/v1/chains"
    })
      .then((payload) => {
        if (!cancelled) {
          setChainsByNetwork(mapChainsByNetwork(payload.items));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setChainsByNetwork({});
        }
      });
    return () => {
      cancelled = true;
    };
  }, [auth]);

  useEffect(() => {
    if (bridgeFlow?.phase !== "preflight") {
      return;
    }
    const maxStep = gasTopUpLikely ? 3 : 2;
    const timer = setInterval(() => {
      setBridgeFlow((current) => {
        if (!current || current.phase !== "preflight") {
          return current;
        }
        const nextIndex = Math.min(current.preflightStepIndex + 1, maxStep);
        if (nextIndex === current.preflightStepIndex) {
          return current;
        }
        return { ...current, preflightStepIndex: nextIndex };
      });
    }, BRIDGE_PREFLIGHT_STEP_MS);
    return () => clearInterval(timer);
  }, [bridgeFlow?.phase, gasTopUpLikely]);

  useEffect(() => {
    if (!auth || bridgeFlow?.phase !== "bridging" || !bridgeFlow.consolidationId) {
      return;
    }

    const consolidationId = bridgeFlow.consolidationId;
    let cancelled = false;
    let attempts = 0;
    let timeoutId = null;

    const poll = async () => {
      if (cancelled) {
        return;
      }
      attempts += 1;
      try {
        const item = await fetchConsolidationById(auth, consolidationId);
        if (cancelled) {
          return;
        }
        if (!item) {
          if (attempts < BRIDGE_POLL_MAX_ATTEMPTS) {
            timeoutId = setTimeout(poll, BRIDGE_POLL_MS);
          }
          return;
        }

        if (item.status === "confirmed") {
          setBridgeFlow((current) => ({
            ...current,
            phase: "refreshing",
            backgroundStepIndex: 2,
            consolidation: item,
            errorMessage: ""
          }));
          await Promise.race([
            refreshOverview(auth, { onchainMode: "priority", showRefreshing: false }),
            new Promise((resolve) => {
              window.setTimeout(resolve, BRIDGE_REFRESH_TIMEOUT_MS);
            })
          ]);
          if (!cancelled) {
            setBridgeFlow((current) => ({
              ...current,
              phase: "confirmed",
              backgroundStepIndex: 2,
              consolidation: item,
              errorMessage: ""
            }));
          }
          return;
        }

        if (item.status === "failed") {
          setBridgeFlow((current) => ({
            ...current,
            phase: "failed",
            backgroundStepIndex: 1,
            consolidation: item,
            errorMessage: item.failReason || "Bridge transfer failed"
          }));
          return;
        }

        setBridgeFlow((current) => ({
          ...current,
          consolidation: item,
          backgroundStepIndex: item.status === "submitted" ? 1 : 0
        }));

        if (attempts < BRIDGE_POLL_MAX_ATTEMPTS) {
          timeoutId = setTimeout(poll, BRIDGE_POLL_MS);
        } else {
          setBridgeFlow((current) => ({
            ...current,
            errorMessage:
              "Bridge is still running. Check Activity for status, or refresh balances in a few minutes."
          }));
        }
      } catch {
        if (!cancelled && attempts < BRIDGE_POLL_MAX_ATTEMPTS) {
          timeoutId = setTimeout(poll, BRIDGE_POLL_MS);
        }
      }
    };

    timeoutId = setTimeout(poll, BRIDGE_POLL_MS);
    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [auth, bridgeFlow?.consolidationId]);

  const bridgeProtocolFees = Array.isArray(bridgeEstimate?.protocolFees) ? bridgeEstimate.protocolFees : [];
  const bridgeRecommendation = bridgeEstimate?.recommendation || null;

  return (
    <PlatformShell title="Overview" auth={auth} onLogout={logout}>
      {error ? <p className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {loading && !data && !error ? <OverviewBalancesSkeleton networkRows={6} /> : null}

      {data ? (
        <div className="space-y-4">
          <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-rail-800 p-5 text-white shadow-panel">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(255,255,255,0.18),transparent_40%)]"></div>
            <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(-38deg,rgba(255,255,255,0.06)_0,rgba(255,255,255,0.06)_2px,transparent_2px,transparent_34px)]"></div>
            <div className="relative z-10">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-200">Available Balance</p>
                <div className="flex items-center gap-2">
                  {!balancesReady ? (
                    <span className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] text-slate-100">
                      Loading live balances...
                    </span>
                  ) : refreshing ? (
                    <span className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] text-slate-100">
                      Updating...
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => refreshOverview(auth, { onchainMode: "priority" })}
                    disabled={refreshing || !balancesReady}
                    className="rounded-full border border-white/25 bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-white/20 disabled:opacity-60"
                  >
                    Refresh
                  </button>
                </div>
              </div>
              <p className="mt-2 text-4xl font-semibold">
                <UsdAmount
                  value={data.availableUsd}
                  ready={balancesReady}
                  skeletonVariant="dark"
                  skeletonClassName="h-10 w-44"
                />
              </p>
              <p className="mt-2 text-sm text-slate-200/95">
                Projected ledger balance:{" "}
                <UsdAmount
                  value={data.projectedUsd || data.availableUsd}
                  ready={balancesReady}
                  skeletonVariant="dark"
                  skeletonClassName="inline-block h-4 w-24 align-middle"
                />
              </p>
              <p className="mt-1 text-sm text-slate-200/95">
                Pending/reconciling:{" "}
                <UsdAmount
                  value={data.pendingBridgeUsd}
                  ready={balancesReady}
                  skeletonVariant="dark"
                  skeletonClassName="inline-block h-4 w-20 align-middle"
                />
              </p>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
            <h3 className="text-base font-semibold">Balances by network</h3>
            <div className={`mt-2 ${sortedBalances.length || !balancesReady ? "h-[420px] overflow-y-auto pr-1" : ""}`}>
              <div className="grid gap-2">
                {!balancesReady ? (
                  (sortedBalances.length ? sortedBalances : Array.from({ length: 6 }, (_, index) => ({ network: `skeleton-${index}` }))).map(
                    (item) =>
                      item.network?.startsWith("skeleton-") ? (
                        <NetworkBalanceRowSkeleton key={item.network} />
                      ) : (
                        <article key={item.network} className="rounded-xl border border-slate-200 bg-white p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100">
                                {getNetworkInfo(item.network).logo ? (
                                  <img
                                    src={getNetworkInfo(item.network).logo}
                                    alt=""
                                    className="h-7 w-7 object-contain"
                                  />
                                ) : (
                                  <span className="text-xs font-semibold text-slate-500">
                                    {getNetworkInfo(item.network).name.charAt(0)}
                                  </span>
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">{getNetworkInfo(item.network).name}</p>
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-1.5 text-right">
                              <UsdAmount
                                value={item.usdValue}
                                ready={false}
                                className="text-sm font-semibold"
                                skeletonClassName="h-4 w-16"
                              />
                              <div className="flex items-center justify-end gap-1 text-xs text-slate-500">
                                {getTokenInfo(item.asset).logo ? (
                                  <img
                                    src={getTokenInfo(item.asset).logo}
                                    alt={getTokenInfo(item.asset).symbol}
                                    className="h-3.5 w-3.5 rounded-full object-contain"
                                  />
                                ) : null}
                                <UsdcAmount
                                  value={formatUsdcBaseUnits(item.amount)}
                                  ready={false}
                                  symbol={getTokenInfo(item.asset).symbol}
                                  skeletonClassName="h-3.5 w-24"
                                />
                              </div>
                            </div>
                          </div>
                        </article>
                      )
                  )
                ) : sortedBalances.length ? (
                  sortedBalances.map((item) => {
                    const network = getNetworkInfo(item.network);
                    const token = getTokenInfo(item.asset);
                    return (
                      <article key={item.network} className="rounded-xl border border-slate-200 bg-white p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100">
                              {network.logo ? (
                                <img src={network.logo} alt="" className="h-7 w-7 object-contain" />
                              ) : (
                                <span className="text-xs font-semibold text-slate-500">
                                  {network.name.charAt(0)}
                                </span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">{network.name}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold">
                              <UsdAmount value={item.usdValue} ready={true} className="text-sm font-semibold" />
                            </p>
                            <p className="mt-0.5 flex items-center justify-end gap-1 text-xs text-slate-500">
                              {token.logo ? (
                                <img src={token.logo} alt={token.symbol} className="h-3.5 w-3.5 rounded-full object-contain" />
                              ) : null}
                              <UsdcAmount
                                value={formatUsdcBaseUnits(item.amount)}
                                ready={true}
                                symbol={token.symbol}
                              />
                            </p>
                          </div>
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <p className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-500">No balances yet.</p>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
            <h3 className="text-base font-semibold">Move funds between networks (advanced)</h3>
            <form className="mt-2 grid gap-2" onSubmit={submitConsolidation}>
              <div className="grid gap-2 md:grid-cols-3">
                <label className="text-xs text-slate-500">
                  From
                  <div className="relative mt-1.5" ref={sourceDropdownRef}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-xl border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-900"
                      onClick={() => {
                        setSourceDropdownOpen((open) => !open);
                        setDestinationDropdownOpen(false);
                      }}
                      disabled={!sourceDropdownItems.length}
                    >
                      {selectedSourceOption ? (
                        <span className="inline-flex items-center gap-2">
                          <BridgeNetworkOptionIcon network={selectedSourceOption.network} />
                          <span>{selectedSourceOption.name}</span>
                        </span>
                      ) : (
                        <span className="text-slate-500">Select source network</span>
                      )}
                      <span className="text-slate-500">{sourceDropdownOpen ? "▴" : "▾"}</span>
                    </button>
                    {sourceDropdownOpen ? (
                      <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-300 bg-white p-1 shadow-xl">
                        {sourceDropdownItems.map((item) => {
                          const isSelected = item.network === bridgeForm.sourceNetwork;
                          return (
                            <button
                              key={`source-network-option-${item.network}`}
                              type="button"
                              className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm ${
                                isSelected
                                  ? "bg-rail-50 text-rail-800"
                                  : "text-slate-700 hover:bg-slate-100"
                              }`}
                              onClick={() => {
                                setBridgeForm((current) => ({ ...current, sourceNetwork: item.network }));
                                setSourceDropdownOpen(false);
                              }}
                            >
                              <span className="inline-flex items-center gap-2">
                                <BridgeNetworkOptionIcon network={item.network} />
                                <span>{item.name}</span>
                              </span>
                              <span className="text-xs font-medium text-slate-500">
                                {formatUsdcBaseUnits(balancesByNetwork[item.network]?.amount || "0")} USDC
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </label>
                <label className="text-xs text-slate-500">
                  To
                  <div className="relative mt-1.5" ref={destinationDropdownRef}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-xl border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-900"
                      onClick={() => {
                        setDestinationDropdownOpen((open) => !open);
                        setSourceDropdownOpen(false);
                      }}
                      disabled={!destinationDropdownItems.length}
                    >
                      {selectedDestinationOption ? (
                        <span className="inline-flex items-center gap-2">
                          <BridgeNetworkOptionIcon network={selectedDestinationOption.network} />
                          <span>{selectedDestinationOption.name}</span>
                        </span>
                      ) : (
                        <span className="text-slate-500">Select destination network</span>
                      )}
                      <span className="text-slate-500">{destinationDropdownOpen ? "▴" : "▾"}</span>
                    </button>
                    {destinationDropdownOpen ? (
                      <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-300 bg-white p-1 shadow-xl">
                        {destinationDropdownItems.map((item) => {
                          const isSelected = item.network === bridgeForm.destinationNetwork;
                          return (
                            <button
                              key={`destination-network-option-${item.network}`}
                              type="button"
                              className={`flex w-full items-center rounded-lg px-2 py-1.5 text-left text-sm ${
                                isSelected
                                  ? "bg-rail-50 text-rail-800"
                                  : "text-slate-700 hover:bg-slate-100"
                              }`}
                              onClick={() => {
                                setBridgeForm((current) => ({ ...current, destinationNetwork: item.network }));
                                setDestinationDropdownOpen(false);
                              }}
                            >
                              <span className="inline-flex items-center gap-2">
                                <BridgeNetworkOptionIcon network={item.network} />
                                <span>{item.name}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </label>
                <label className="text-xs text-slate-500">
                  Amount (USDC)
                  <div className="relative mt-1.5">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-700">$</span>
                    <input
                      className="w-full rounded-xl border border-slate-300 bg-white pl-7 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
                      value={bridgeForm.amountUsdc}
                      onChange={(event) => setBridgeForm((current) => ({ ...current, amountUsdc: event.target.value }))}
                      placeholder="0.10"
                      required
                    />
                  </div>
                </label>
              </div>

              <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                <p>
                  Available on source network:
                  {" "}
                  <span className="font-semibold text-slate-700">{sourceAvailableUsdc} USDC</span>
                </p>
                <button
                  type="button"
                  onClick={() =>
                    setBridgeForm((current) => ({
                      ...current,
                      amountUsdc: sourceAvailableUsdc
                    }))
                  }
                  disabled={!bridgeForm.sourceNetwork || sourceAvailableBaseUnits <= 0n}
                  className="rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  Use max
                </button>
              </div>
              {insufficientSourceBalance ? (
                <p className="text-xs text-rose-600">Amount exceeds available source balance.</p>
              ) : null}

              {bridgeEstimateBusy ? (
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-500">
                  Estimating Circle bridge costs...
                </div>
              ) : null}

              {bridgeEstimateError ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-700">
                  {bridgeEstimateError}
                </div>
              ) : null}

              {bridgeEstimate ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Estimated bridge cost</p>
                      <p className="mt-1 text-xs text-slate-500">{bridgeEstimate.note}</p>
                    </div>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                      {bridgeEstimate.executionMode === "real" ? "Circle Bridge Kit estimate" : "Simulation mode"}
                    </span>
                  </div>

                  {bridgeEstimate.bridgeKitEstimateStatus === "fallback" ? (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Using fallback gas heuristic because Circle Bridge Kit estimate was unavailable
                      {bridgeEstimate.bridgeKitEstimateError ? `: ${bridgeEstimate.bridgeKitEstimateError}` : "."}
                    </div>
                  ) : null}

                  {bridgeGasFees.length ? (
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {bridgeGasFees.map((item) => {
                        const network = getNetworkInfo(item.network);
                        return (
                          <article key={`${item.role}-${item.network}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-xs uppercase tracking-wide text-slate-500">
                                  {item.role === "source" ? "Source network gas" : "Destination network gas"}
                                </p>
                                <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-slate-900">
                                  <BridgeNetworkOptionIcon network={item.network} />
                                  <span>{network.name}</span>
                                </p>
                              </div>
                              <span
                                className={`rounded-full px-2 py-1 text-[11px] font-medium ${
                                  item.sufficient
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-amber-100 text-amber-800"
                                }`}
                              >
                                {item.sufficient ? "Ready" : "Top-up likely"}
                              </span>
                            </div>
                            <div className="mt-3 grid gap-1 text-xs text-slate-600">
                              <p>
                                Estimated gas:{" "}
                                <span className="font-semibold text-slate-900">
                                  {item.estimatorEstimatedFeeNative || formatNativeWei(item.estimatorEstimatedFeeWei)}{" "}
                                  {item.tokenSymbol || "ETH"}
                                </span>
                              </p>
                              <p>
                                Required wallet balance:{" "}
                                <span className="font-semibold text-slate-900">
                                  {item.requiredNative} {item.tokenSymbol || "ETH"}
                                </span>
                              </p>
                              <p>
                                Current wallet balance:{" "}
                                <span className="font-semibold text-slate-900">
                                  {item.availableNative} {item.tokenSymbol || "ETH"}
                                </span>
                              </p>
                              {!item.sufficient ? (
                                <p className="text-amber-700">
                                  Shortfall:{" "}
                                  <span className="font-semibold">
                                    {item.shortfallNative} {item.tokenSymbol || "ETH"}
                                  </span>
                                  {bridgeEstimate?.sponsorPolicy?.autoTopupEnabled
                                    ? " · RailBridge will attempt sponsor top-up on submit."
                                    : " · Fund this wallet before submitting."}
                                </p>
                              ) : null}
                              {item.estimatorStepNames?.length ? (
                                <p className="text-slate-500">
                                  Estimated steps: {item.estimatorStepNames.join(", ")}
                                </p>
                              ) : null}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : null}

                  {bridgeProtocolFees.length ? (
                    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Protocol fees</p>
                      <div className="mt-2 grid gap-1 text-sm text-slate-700">
                        {bridgeProtocolFees.map((item, index) => (
                          <p key={`protocol-fee-${index}`}>
                            <span className="font-medium capitalize">{item.type}</span>:{" "}
                            <span className="font-semibold text-slate-900">
                              {item.amount ?? "-"} {item.token || "USDC"}
                            </span>
                          </p>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {bridgeRecommendation ? (
                    <div className={`mt-3 rounded-xl border px-3 py-3 text-sm ${recommendationTone(bridgeRecommendation.level)}`}>
                      <p className="font-semibold">{bridgeRecommendation.summary}</p>
                      <p className="mt-1 text-xs">{bridgeRecommendation.details}</p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={
                  bridgeFlowIsActive(bridgeFlow) ||
                  !sourceNetworkOptions.length ||
                  destinationOptions.length < 1 ||
                  insufficientSourceBalance
                }
                className="rounded-xl border border-rail-700 bg-gradient-to-br from-rail-700 to-rail-800 px-3 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-60"
              >
                {bridgeSubmitButtonLabel(bridgeFlow)}
              </button>

              <BridgeTransferProgress
                phase={bridgeFlow?.phase || "idle"}
                preflightStepIndex={bridgeFlow?.preflightStepIndex ?? 0}
                backgroundStepIndex={bridgeFlow?.backgroundStepIndex ?? 0}
                gasTopUpLikely={gasTopUpLikely}
                consolidation={bridgeFlow?.consolidation || null}
                errorMessage={bridgeFlow?.errorMessage || ""}
                chainsByNetwork={chainsByNetwork}
                onDismiss={dismissBridgeFlow}
              />
            </form>
            {!sourceNetworkOptions.length ? (
              <p className="mt-2 text-xs text-slate-500">No spendable source balance yet. Receive settlement funds first, then move funds.</p>
            ) : destinationOptions.length < 1 ? (
              <p className="mt-2 text-xs text-slate-500">A different destination network is required for consolidation.</p>
            ) : networkOptions.length < 2 ? (
              <p className="mt-2 text-xs text-slate-500">At least two networks are needed for consolidation.</p>
            ) : null}
          </section>
        </div>
      ) : null}
    </PlatformShell>
  );
}
