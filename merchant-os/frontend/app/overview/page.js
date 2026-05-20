"use client";

import { useEffect, useMemo, useState } from "react";
import PlatformShell from "../../components/console/PlatformShell";
import { apiWithMerchantKey } from "../../lib/platformClient";
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
  amountUsdc: "0.10"
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

export default function OverviewPage() {
  const { auth, logout } = useAuthGuard();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [bridgeForm, setBridgeForm] = useState(defaultBridgeForm);
  const [bridgeBusy, setBridgeBusy] = useState(false);
  const [bridgeMessage, setBridgeMessage] = useState("");
  const [bridgeError, setBridgeError] = useState("");
  const [showTestnetsOnly, setShowTestnetsOnly] = useState(false);

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

  const loadOverview = async (currentAuth) => {
    const payload = await apiWithMerchantKey({
      apiKey: currentAuth.apiKey,
      path: `/v1/merchants/${currentAuth.merchantId}/balances`
    });
    setData(payload);
  };

  useEffect(() => {
    if (!auth) {
      return;
    }
    let cancelled = false;
    setError("");
    loadOverview(auth)
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError.message || "Failed to load overview");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [auth]);

  useEffect(() => {
    setShowTestnetsOnly(shouldPreferTestnetsInUi());
  }, []);

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

  const submitConsolidation = async (event) => {
    event.preventDefault();
    if (!auth) {
      return;
    }
    setBridgeError("");
    setBridgeMessage("");

    if (!bridgeForm.sourceNetwork || !bridgeForm.destinationNetwork) {
      setBridgeError("Select both source and destination networks");
      return;
    }
    if (bridgeForm.sourceNetwork === bridgeForm.destinationNetwork) {
      setBridgeError("Source and destination networks must differ");
      return;
    }
    if (requestedBridgeBaseUnits === null || requestedBridgeBaseUnits <= 0n) {
      setBridgeError("Enter a valid USDC amount (up to 6 decimal places)");
      return;
    }
    if (requestedBridgeBaseUnits > sourceAvailableBaseUnits) {
      setBridgeError(
        `Amount exceeds available balance (${sourceAvailableUsdc} USDC) on selected source network`
      );
      return;
    }

    setBridgeBusy(true);
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
      setBridgeMessage(`Transfer submitted (${payload.id || "pending"})`);
      await loadOverview(auth);
    } catch (nextError) {
      setBridgeError(nextError.message || "Failed to submit transfer");
    } finally {
      setBridgeBusy(false);
    }
  };

  return (
    <PlatformShell title="Overview" auth={auth} onLogout={logout}>
      {error ? <p className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {!data && !error ? <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">Loading balances...</p> : null}

      {data ? (
        <div className="space-y-4">
          <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-rail-800 p-5 text-white shadow-panel">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(255,255,255,0.18),transparent_40%)]"></div>
            <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(-38deg,rgba(255,255,255,0.06)_0,rgba(255,255,255,0.06)_2px,transparent_2px,transparent_34px)]"></div>
            <div className="relative z-10">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-200">Available Balance</p>
              <p className="mt-2 text-4xl font-semibold">${data.availableUsd || "0.00"}</p>
              <p className="mt-2 text-sm text-slate-200/95">
                Projected ledger balance: ${data.projectedUsd || data.availableUsd || "0.00"}
              </p>
              <p className="mt-1 text-sm text-slate-200/95">Pending/reconciling: ${data.pendingBridgeUsd || "0.00"}</p>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
            <h3 className="text-base font-semibold">Balances by network</h3>
            <div className={`mt-2 ${sortedBalances.length ? "h-[420px] overflow-y-auto pr-1" : ""}`}>
              <div className="grid gap-2">
                {sortedBalances.length ? (
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
                            <p className="text-sm font-semibold">${item.usdValue}</p>
                            <p className="mt-0.5 flex items-center justify-end gap-1 text-xs text-slate-500">
                              {token.logo ? (
                                <img src={token.logo} alt={token.symbol} className="h-3.5 w-3.5 rounded-full object-contain" />
                              ) : null}
                              <span>{formatUsdcBaseUnits(item.amount)} {token.symbol}</span>
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
                  <select
                    className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    value={bridgeForm.sourceNetwork}
                    onChange={(event) => setBridgeForm((current) => ({ ...current, sourceNetwork: event.target.value }))}
                    required
                  >
                    {(sourceNetworkOptions.length ? sourceNetworkOptions : networkOptions).map((network) => (
                      <option key={`source-${network}`} value={network}>
                        {getNetworkInfo(network).name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-500">
                  To
                  <select
                    className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    value={bridgeForm.destinationNetwork}
                    onChange={(event) => setBridgeForm((current) => ({ ...current, destinationNetwork: event.target.value }))}
                    required
                  >
                    {destinationOptions.map((network) => (
                      <option key={`destination-${network}`} value={network}>
                        {getNetworkInfo(network).name}
                      </option>
                    ))}
                  </select>
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

              <button
                type="submit"
                disabled={
                  bridgeBusy ||
                  !sourceNetworkOptions.length ||
                  destinationOptions.length < 1 ||
                  insufficientSourceBalance
                }
                className="rounded-xl border border-rail-700 bg-gradient-to-br from-rail-700 to-rail-800 px-3 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-60"
              >
                {bridgeBusy ? "Submitting..." : "Move funds"}
              </button>
            </form>
            {bridgeMessage ? <p className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{bridgeMessage}</p> : null}
            {bridgeError ? <p className="mt-2 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">{bridgeError}</p> : null}
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
