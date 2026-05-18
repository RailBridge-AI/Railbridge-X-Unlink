"use client";

import { useEffect, useMemo, useState } from "react";
import PlatformShell from "../../components/console/PlatformShell";
import { apiWithMerchantKey } from "../../lib/platformClient";
import { useAuthGuard } from "../../lib/useAuthGuard";
import { formatUsdcBaseUnits, getNetworkInfo, getTokenInfo } from "../../lib/assetDisplay";

const initialForm = {
  network: "",
  amountUsdc: "1.00",
  destinationAddress: ""
};

const formatDate = (value) => {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
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

export default function PayoutsPage() {
  const { auth, logout } = useAuthGuard();
  const [form, setForm] = useState(initialForm);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [events, setEvents] = useState([]);
  const [networkOptions, setNetworkOptions] = useState([]);
  const [balances, setBalances] = useState([]);

  const balancesByNetwork = useMemo(
    () =>
      (balances || []).reduce((map, item) => {
        if (item?.network) {
          map[item.network] = item;
        }
        return map;
      }, {}),
    [balances]
  );

  const selectedBalanceBaseUnits = parseBaseUnitsSafe(balancesByNetwork[form.network]?.amount || "0");
  const selectedBalanceUsdc = baseUnitsToUsdcInput(selectedBalanceBaseUnits.toString());
  const requestedBaseUnits = parseUsdcInputToBaseUnits(form.amountUsdc);
  const insufficientFunds =
    requestedBaseUnits !== null &&
    form.network &&
    requestedBaseUnits > selectedBalanceBaseUnits;

  const loadPayoutEvents = async (currentAuth) => {
    const [payoutsPayload, balancesPayload] = await Promise.all([
      apiWithMerchantKey({
        apiKey: currentAuth.apiKey,
        path: `/v1/merchants/${currentAuth.merchantId}/payouts`
      }),
      apiWithMerchantKey({
        apiKey: currentAuth.apiKey,
        path: `/v1/merchants/${currentAuth.merchantId}/balances`
      })
    ]);

    const nextEvents = payoutsPayload.items || [];
    const nextBalances = Array.isArray(balancesPayload.balances)
      ? balancesPayload.balances.filter((item) => item?.network && String(item.asset || "USDC").toUpperCase() === "USDC")
      : [];
    const spendableBalances = nextBalances.filter((item) => parseBaseUnitsSafe(item.amount) > 0n);
    const nextNetworkOptions = [
      ...new Set(
        spendableBalances
          .map((item) => item.network)
          .filter(Boolean)
      )
    ];
    setEvents(nextEvents);
    setBalances(nextBalances);
    setNetworkOptions(nextNetworkOptions);
    setForm((current) => ({
      ...current,
      network:
        current.network && nextNetworkOptions.includes(current.network)
          ? current.network
          : nextNetworkOptions[0] || ""
    }));
  };

  useEffect(() => {
    if (!auth) {
      return;
    }
    loadPayoutEvents(auth).catch((nextError) => setError(nextError.message || "Failed to load payouts"));
  }, [auth]);

  const submitPayout = async (event) => {
    event.preventDefault();
    if (!auth) {
      return;
    }
    setError("");
    setMessage("");
    if (!form.network) {
      setError("Select a payout network with available balance.");
      return;
    }
    const nextRequestedBaseUnits = parseUsdcInputToBaseUnits(form.amountUsdc);
    if (nextRequestedBaseUnits === null || nextRequestedBaseUnits <= 0n) {
      setError("Enter a valid USDC amount (up to 6 decimal places).");
      return;
    }
    if (nextRequestedBaseUnits > selectedBalanceBaseUnits) {
      setError(`Amount exceeds available balance (${selectedBalanceUsdc} USDC).`);
      return;
    }
    try {
      const payout = await apiWithMerchantKey({
        apiKey: auth.apiKey,
        path: `/v1/merchants/${auth.merchantId}/payouts`,
        method: "POST",
        body: {
          network: form.network,
          amountUsdc: form.amountUsdc,
          destinationAddress: form.destinationAddress
        }
      });
      const txHashText = payout?.txHash ? ` · tx ${payout.txHash}` : "";
      setMessage(`Payout ${payout?.status || "submitted"}${txHashText}.`);
      setForm(initialForm);
      await loadPayoutEvents(auth);
    } catch (nextError) {
      setError(nextError.message || "Failed to submit payout");
    }
  };

  return (
    <PlatformShell title="Payouts" auth={auth} onLogout={logout}>
      <form className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3.5" onSubmit={submitPayout}>
        <p className="text-base font-semibold">Request payout</p>
        <label className="text-xs text-slate-500">
          From network
          <select
            className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            value={form.network}
            onChange={(event) => setForm((curr) => ({ ...curr, network: event.target.value }))}
            required
          >
            {networkOptions.map((network) => (
              <option key={`payout-network-${network}`} value={network}>
                {getNetworkInfo(network).name}
                {" · "}
                {formatUsdcBaseUnits(balancesByNetwork[network]?.amount || "0")} USDC
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center justify-between gap-2 text-xs">
          <p className="text-slate-500">
            Available: <span className="font-semibold text-slate-700">{selectedBalanceUsdc} USDC</span>
          </p>
          <button
            type="button"
            onClick={() => setForm((curr) => ({ ...curr, amountUsdc: selectedBalanceUsdc }))}
            disabled={!form.network || selectedBalanceBaseUnits <= 0n}
            className="rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            Use max
          </button>
        </div>
        <input className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="Amount USDC" value={form.amountUsdc} onChange={(event) => setForm((curr) => ({ ...curr, amountUsdc: event.target.value }))} required />
        {insufficientFunds ? (
          <p className="text-xs text-rose-600">
            Amount exceeds available balance for this network.
          </p>
        ) : null}
        <input className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="Destination address" value={form.destinationAddress} onChange={(event) => setForm((curr) => ({ ...curr, destinationAddress: event.target.value }))} required />
        <button
          className="rounded-xl border border-rail-700 bg-gradient-to-br from-rail-700 to-rail-800 px-3 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-60"
          disabled={!networkOptions.length || insufficientFunds}
        >
          Submit payout
        </button>
      </form>

      {message ? <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {!networkOptions.length ? (
        <p className="mt-2 text-xs text-slate-500">No payout-capable network yet. Receive a settlement first.</p>
      ) : null}

      <div className="mt-4 grid gap-2">
        {events.map((item) => {
          const network = getNetworkInfo(item.sourceNetwork);
          const token = getTokenInfo(item.asset || "USDC");
          return (
            <article key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">
                  {formatUsdcBaseUnits(item.amount)} {token.symbol} · {item.status}
                </p>
                <p className="text-xs text-slate-500">{formatDate(item.createdAt)}</p>
              </div>
              <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                {network.logo ? <img src={network.logo} alt="" className="h-3.5 w-3.5 rounded-full object-contain" /> : null}
                <span>{network.name}</span>
              </p>
              <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                {token.logo ? <img src={token.logo} alt={token.symbol} className="h-3.5 w-3.5 rounded-full object-contain" /> : null}
                <span>{token.symbol}</span>
              </p>
              <p className="mt-1 break-all font-mono text-xs text-slate-500">tx: {item.txHash || "-"}</p>
              {item.failReason ? (
                <p className="mt-1 text-xs text-rose-600">reason: {item.failReason}</p>
              ) : null}
            </article>
          );
        })}
      </div>
    </PlatformShell>
  );
}
