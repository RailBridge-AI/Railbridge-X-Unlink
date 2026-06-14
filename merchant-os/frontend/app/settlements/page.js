"use client";

import { useEffect, useState } from "react";
import PlatformShell from "../../components/console/PlatformShell";
import { apiWithMerchantKey } from "../../lib/platformClient";
import { useAuthGuard } from "../../lib/useAuthGuard";
import { formatUsdcBaseUnits, getNetworkInfo, getTokenInfo } from "../../lib/assetDisplay";
import { buildExplorerTransactionUrl, mapChainsByNetwork } from "../../lib/explorerLinks";

const PAGE_SIZE_OPTIONS = [5, 10, 20];
const TYPE_OPTIONS = [
  { value: "all", label: "All activity" },
  { value: "treasury", label: "Treasury" },
  { value: "payment", label: "Payment" },
  { value: "payouts", label: "Payouts" }
];

const formatDate = (value) => {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const statusLabel = (itemType, status) => {
  const normalizedStatus = String(status || "").trim();
  const settlementMap = {
    settled_source: "Received",
    bridge_pending: "Moving Funds",
    bridge_confirmed: "Transfer Complete",
    failed: "Failed"
  };
  const privateSweepMap = {
    submitted: "Sweep Submitted",
    confirmed: "Sweep Complete",
    failed: "Sweep Failed"
  };
  const privateTransferMap = {
    submitted: "Transfer Submitted",
    confirmed: "Private Credit",
    failed: "Transfer Failed"
  };
  const privateWithdrawalMap = {
    submitted: "Withdrawal Submitted",
    confirmed: "Withdrawal Complete",
    failed: "Withdrawal Failed"
  };
  const consolidationMap = {
    submitted: "Submitted",
    confirmed: "Transfer Complete",
    failed: "Failed"
  };
  const payoutMap = {
    requested: "Requested",
    submitted: "Submitted",
    completed: "Transfer Complete",
    failed: "Failed"
  };
  const map =
    itemType === "consolidation"
      ? consolidationMap
      : itemType === "payout"
        ? payoutMap
        : itemType === "private_sweep"
          ? privateSweepMap
          : itemType === "private_transfer"
            ? privateTransferMap
            : itemType === "private_withdrawal"
              ? privateWithdrawalMap
              : settlementMap;
  return map[normalizedStatus] || normalizedStatus || "Unknown";
};

const resolvePrimaryTransactionNetwork = (item) => {
  const txHash = String(item.txHash || "").trim();
  if (!txHash) {
    return "";
  }

  const normalizedTxHash = txHash.toLowerCase();
  const sourceTxHash = String(item.sourceTxHash || "").trim().toLowerCase();
  const bridgeTxHash = String(item.bridgeTxHash || "").trim().toLowerCase();
  const destinationTxHash = String(item.destinationTxHash || "").trim().toLowerCase();

  let network = item.sourceNetwork || item.destinationNetwork || "";
  if (destinationTxHash && normalizedTxHash === destinationTxHash && item.destinationNetwork) {
    network = item.destinationNetwork;
  } else if (bridgeTxHash && normalizedTxHash === bridgeTxHash && item.sourceNetwork) {
    network = item.sourceNetwork;
  } else if (sourceTxHash && normalizedTxHash === sourceTxHash && item.sourceNetwork) {
    network = item.sourceNetwork;
  }

  return String(network || "").trim();
};

const itemTypeBadge = (item) => {
  const itemType = item?.itemType;
  if (itemType === "consolidation") {
    return {
      label: "Treasury Bridge",
      tone: "border-sky-200 bg-sky-50 text-sky-800"
    };
  }
  if (itemType === "payout") {
    return {
      label: "Payout",
      tone: "border-amber-200 bg-amber-50 text-amber-800"
    };
  }
  if (itemType === "private_sweep") {
    return {
      label: "Private Sweep",
      tone: "border-violet-200 bg-violet-50 text-violet-800"
    };
  }
  if (itemType === "private_transfer") {
    return {
      label: "Private Transfer",
      tone: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800"
    };
  }
  if (itemType === "private_withdrawal") {
    return {
      label: "Private Withdrawal",
      tone: "border-amber-200 bg-amber-50 text-amber-800"
    };
  }
  if (item?.privacyStage === "public_intake") {
    return {
      label: "Public Intake",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-800"
    };
  }
  return {
    label: "Payment",
    tone: "border-emerald-200 bg-emerald-50 text-emerald-800"
  };
};

const itemHeadline = (item) => {
  const itemType = item?.itemType;
  if (itemType === "consolidation") {
    return "Treasury transfer";
  }
  if (itemType === "payout") {
    return "Payout";
  }
  if (itemType === "private_sweep") {
    return "Omnibus sweep";
  }
  if (itemType === "private_transfer") {
    return "Private treasury credit";
  }
  if (itemType === "private_withdrawal") {
    return "Private treasury withdrawal";
  }
  if (item?.privacyStage === "public_intake") {
    return "Public intake payment";
  }
  return "Customer payment";
};

const NetworkPath = ({ source, destination, destinationLabel }) => (
  <span className="inline-flex items-center gap-1.5">
    <span className="inline-flex items-center gap-1">
      {source?.logo ? (
        <img src={source.logo} alt="" className="h-3.5 w-3.5 rounded-full object-contain" />
      ) : null}
      <span>{source?.name || "Unknown"}</span>
    </span>
    <span aria-hidden="true">-&gt;</span>
    <span className="inline-flex items-center gap-1">
      {destination?.logo ? (
        <img src={destination.logo} alt="" className="h-3.5 w-3.5 rounded-full object-contain" />
      ) : null}
      <span>{destinationLabel}</span>
    </span>
  </span>
);

const buildTransactionEntries = (item, chainsByNetwork) => {
  const entries = [];
  const seen = new Set();

  const pushEntry = ({ label, txHash, network }) => {
    const normalizedHash = String(txHash || "").trim();
    const normalizedNetwork = String(network || "").trim();
    if (!normalizedHash) {
      return;
    }

    const key = `${normalizedHash.toLowerCase()}::${normalizedNetwork}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);

    const chain = chainsByNetwork[normalizedNetwork];
    const networkInfo = normalizedNetwork ? getNetworkInfo(normalizedNetwork) : null;
    entries.push({
      label,
      txHash: normalizedHash,
      network: normalizedNetwork,
      networkName: networkInfo?.name || "",
      explorerUrl: buildExplorerTransactionUrl(chain?.explorerUrl, normalizedHash)
    });
  };

  if (item.itemType === "consolidation") {
    const sourceTxHash = String(item.sourceTxHash || "").trim();
    const bridgeTxHash = String(item.bridgeTxHash || "").trim();
    if (sourceTxHash && bridgeTxHash && sourceTxHash.toLowerCase() === bridgeTxHash.toLowerCase()) {
      pushEntry({
        label: "Bridge tx",
        txHash: bridgeTxHash,
        network: item.sourceNetwork
      });
    } else {
      if (sourceTxHash) {
        pushEntry({
          label: "Source tx",
          txHash: sourceTxHash,
          network: item.sourceNetwork
        });
      }
      if (bridgeTxHash) {
        pushEntry({
          label: "Bridge tx",
          txHash: bridgeTxHash,
          network: item.sourceNetwork
        });
      }
    }
    if (String(item.destinationTxHash || "").trim()) {
      pushEntry({
        label: "Receive tx",
        txHash: item.destinationTxHash,
        network: item.destinationNetwork || item.sourceNetwork
      });
    }
  } else if (item.itemType === "settlement") {
    pushEntry({
      label: item.privacyStage === "public_intake" ? "Public intake tx" : "Payment tx",
      txHash: item.sourceTxHash,
      network: item.sourceNetwork
    });

    if (String(item.bridgeTxHash || "").trim()) {
      pushEntry({
        label: "Bridge tx",
        txHash: item.bridgeTxHash,
        network: item.sourceNetwork
      });
    }

    if (String(item.destinationTxHash || "").trim()) {
      pushEntry({
        label:
          item.destinationNetwork && item.destinationNetwork !== item.sourceNetwork
            ? "Receive tx"
            : "Settlement tx",
        txHash: item.destinationTxHash,
        network: item.destinationNetwork || item.sourceNetwork
      });
    }
  } else if (item.itemType === "private_sweep" || item.itemType === "private_transfer" || item.itemType === "private_withdrawal") {
    if (String(item.providerTxId || "").trim()) {
      entries.push({
        label: "Unlink tx id",
        txHash: String(item.providerTxId).trim(),
        network: "",
        networkName: "",
        explorerUrl: null,
        isProviderReference: true
      });
    }
    if (String(item.txHash || "").trim()) {
      const chain = chainsByNetwork[item.sourceNetwork];
      const networkInfo = item.sourceNetwork ? getNetworkInfo(item.sourceNetwork) : null;
      entries.push({
        label:
          item.itemType === "private_sweep"
            ? "Sweep tx hash"
            : item.itemType === "private_withdrawal"
              ? "Withdrawal tx hash"
              : "Transfer tx hash",
        txHash: String(item.txHash).trim(),
        network: item.sourceNetwork,
        networkName: networkInfo?.name || "",
        explorerUrl: buildExplorerTransactionUrl(chain?.explorerUrl, item.txHash),
        isProviderReference: !chain?.explorerUrl
      });
    }
  } else if (item.itemType === "payout") {
    pushEntry({
      label: "Payout tx",
      txHash: item.sourceTxHash || item.txHash,
      network: item.sourceNetwork
    });
  }

  if (!entries.length && String(item.txHash || "").trim()) {
    pushEntry({
      label: "Transaction",
      txHash: item.txHash,
      network: resolvePrimaryTransactionNetwork(item)
    });
  }

  return entries;
};

export default function SettlementsPage() {
  const { auth, logout } = useAuthGuard();
  const [items, setItems] = useState([]);
  const [chainsByNetwork, setChainsByNetwork] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 5,
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false
  });
  const [typeFilter, setTypeFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    if (!auth) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");

    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    if (typeFilter !== "all") {
      params.set("type", typeFilter);
    }
    if (dateFrom) {
      params.set("dateFrom", dateFrom);
    }
    if (dateTo) {
      params.set("dateTo", dateTo);
    }

    Promise.all([
      apiWithMerchantKey({
        apiKey: auth.apiKey,
        path: `/v1/merchants/${auth.merchantId}/settlements?${params.toString()}`
      }),
      apiWithMerchantKey({
        apiKey: auth.apiKey,
        path: "/v1/chains"
      })
    ])
      .then(([settlementsPayload, chainsPayload]) => {
        if (cancelled) {
          return;
        }
        setItems(settlementsPayload.items || []);
        setPagination(
          settlementsPayload.pagination || {
            page: 1,
            pageSize,
            total: settlementsPayload.items?.length || 0,
            totalPages: 1,
            hasNextPage: false,
            hasPreviousPage: false
          }
        );
        setChainsByNetwork(mapChainsByNetwork(chainsPayload.items));
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError.message || "Failed to load activity");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [auth, page, pageSize, typeFilter, dateFrom, dateTo]);

  const activityItems = items.filter(
    (item) =>
      item.itemType === "settlement" || item.itemType === "consolidation" || item.itemType === "payout"
  );

  return (
    <PlatformShell title="Activity" auth={auth} onLogout={logout}>
      <div className="mb-2 grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-4">
        <label className="grid gap-1 text-xs text-slate-600">
          Type
          <select
            value={typeFilter}
            onChange={(event) => {
              setPage(1);
              setTypeFilter(event.target.value);
            }}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
          >
            {TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-slate-600">
          Date from
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => {
              setPage(1);
              setDateFrom(event.target.value);
            }}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
          />
        </label>
        <label className="grid gap-1 text-xs text-slate-600">
          Date to
          <input
            type="date"
            value={dateTo}
            onChange={(event) => {
              setPage(1);
              setDateTo(event.target.value);
            }}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
          />
        </label>
        <div className="grid gap-1 text-xs text-slate-600">
          <span>Result</span>
          <p className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700">
            {pagination.total} item{pagination.total === 1 ? "" : "s"}
          </p>
        </div>
      </div>
      <div className="mb-2 flex items-center justify-end gap-2 text-xs text-slate-600">
        <span>Rows</span>
        <select
          value={String(pageSize)}
          onChange={(event) => {
            setPage(1);
            setPageSize(Number.parseInt(event.target.value, 10) || 5);
          }}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
        >
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={`activity-page-size-${size}`} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>

      {error ? <p className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {loading ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
          Loading activity...
        </p>
      ) : null}
      {!error && !loading && !activityItems.length ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
          No activity found for current filters.
        </p>
      ) : null}

      <div className="grid gap-2">
        {activityItems.map((item) => {
          const source = getNetworkInfo(item.sourceNetwork);
          const destination = item.destinationNetwork ? getNetworkInfo(item.destinationNetwork) : null;
          const token = getTokenInfo(item.asset || "USDC");
          const transactionEntries = buildTransactionEntries(item, chainsByNetwork);
          const badge = itemTypeBadge(item);
          return (
            <article key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${badge.tone}`}>
                    {badge.label}
                  </span>
                  <p className="font-semibold">
                    {itemHeadline(item)} · {statusLabel(item.itemType, item.status)}
                  </p>
                </div>
                <p className="text-xs text-slate-500">{formatDate(item.createdAt)}</p>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {item.itemType === "payout"
                  ? (
                    <NetworkPath
                      source={source}
                      destination={null}
                      destinationLabel={item.destinationAddress || "external wallet"}
                    />
                  )
                  : (
                    <NetworkPath
                      source={source}
                      destination={destination || source}
                      destinationLabel={destination ? destination.name : "same chain"}
                    />
                  )}
              </p>
              <p className="mt-1 flex items-center gap-1 font-medium">
                {token.logo ? <img src={token.logo} alt={token.symbol} className="h-3.5 w-3.5 rounded-full object-contain" /> : null}
                {formatUsdcBaseUnits(item.amount)} {token.symbol}
              </p>
              <div className="mt-1 grid gap-1">
                {transactionEntries.map((entry) => (
                  <p key={`${entry.label}:${entry.txHash}:${entry.network}`} className="break-all font-mono text-xs text-slate-500">
                    <span className="font-sans text-slate-500">
                      {entry.label}
                      {entry.networkName ? ` (${entry.networkName})` : ""}:
                    </span>{" "}
                    {entry.explorerUrl ? (
                      <a
                        href={entry.explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-slate-600 underline decoration-slate-300 underline-offset-4 transition hover:text-slate-900 hover:decoration-slate-500"
                        title="Open transaction in block explorer"
                      >
                        {entry.txHash}
                      </a>
                    ) : (
                      entry.txHash
                    )}
                  </p>
                ))}
              </div>
            </article>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
        <p className="text-xs text-slate-500">
          Page {pagination.page} of {pagination.totalPages}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={!pagination.hasPreviousPage || loading}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setPage((current) => current + 1)}
            disabled={!pagination.hasNextPage || loading}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </PlatformShell>
  );
}
