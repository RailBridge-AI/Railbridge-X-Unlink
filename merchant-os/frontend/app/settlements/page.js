"use client";

import { useEffect, useState } from "react";
import PlatformShell from "../../components/console/PlatformShell";
import { apiWithMerchantKey } from "../../lib/platformClient";
import { useAuthGuard } from "../../lib/useAuthGuard";
import { formatUsdcBaseUnits, getNetworkInfo, getTokenInfo } from "../../lib/assetDisplay";

const formatDate = (value) => {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const statusLabel = (status) => {
  const map = {
    settled_source: "Received",
    bridge_pending: "Moving Funds",
    bridge_confirmed: "Transfer Complete",
    failed: "Failed"
  };
  return map[String(status || "").trim()] || String(status || "Unknown");
};

export default function SettlementsPage() {
  const { auth, logout } = useAuthGuard();
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const settlementItems = items.filter((item) => item.itemType === "settlement");

  useEffect(() => {
    if (!auth) {
      return;
    }
    let cancelled = false;
    apiWithMerchantKey({
      apiKey: auth.apiKey,
      path: `/v1/merchants/${auth.merchantId}/settlements`
    })
      .then((payload) => {
        if (!cancelled) {
          setItems(payload.items || []);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError.message || "Failed to load settlements");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [auth]);

  return (
    <PlatformShell title="Settlements" auth={auth} onLogout={logout}>
      {error ? <p className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {!error && !settlementItems.length ? <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">No settlement events yet.</p> : null}
      <div className="grid gap-2">
        {settlementItems.map((item) => {
          const source = getNetworkInfo(item.sourceNetwork);
          const destination = item.destinationNetwork ? getNetworkInfo(item.destinationNetwork) : null;
          const token = getTokenInfo(item.asset || "USDC");
          return (
            <article key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">Payment · {statusLabel(item.status)}</p>
                <p className="text-xs text-slate-500">{formatDate(item.createdAt)}</p>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {source.name} {"->"} {destination ? destination.name : "same chain"}
              </p>
              <p className="mt-1 flex items-center gap-1 font-medium">
                {token.logo ? <img src={token.logo} alt={token.symbol} className="h-3.5 w-3.5 rounded-full object-contain" /> : null}
                {formatUsdcBaseUnits(item.amount)} {token.symbol}
              </p>
              <p className="mt-1 break-all font-mono text-xs text-slate-500">tx: {item.txHash || "-"}</p>
            </article>
          );
        })}
      </div>
    </PlatformShell>
  );
}
