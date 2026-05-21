"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import PlatformShell from "../../components/console/PlatformShell";
import AddressBookIcon from "../../components/console/AddressBookIcon";
import { apiWithMerchantKey } from "../../lib/platformClient";
import { useAuthGuard } from "../../lib/useAuthGuard";
import { formatUsdcBaseUnits, getNetworkInfo, getTokenInfo } from "../../lib/assetDisplay";
import { buildExplorerTransactionUrl, mapChainsByNetwork } from "../../lib/explorerLinks";

const PAGE_SIZE_OPTIONS = [5, 10, 20];
const initialForm = {
  network: "",
  amountUsdc: "0",
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

const isLikelyEvmAddress = (value) => /^0x[a-fA-F0-9]{40}$/.test(String(value || "").trim());

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

const PayoutNetworkOptionIcon = ({ network }) => {
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

const InlineErrorNotice = ({ children }) => (
  <div className="mt-1.5 inline-flex max-w-full items-start gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0">
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6V10.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="13.2" r="0.9" fill="currentColor" />
    </svg>
    <span className="break-words">{children}</span>
  </div>
);

export default function PayoutsPage() {
  const { auth, logout } = useAuthGuard();
  const [form, setForm] = useState(initialForm);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState("");
  const [events, setEvents] = useState([]);
  const [networkOptions, setNetworkOptions] = useState([]);
  const [balances, setBalances] = useState([]);
  const [addressBookEntries, setAddressBookEntries] = useState([]);
  const [chainsByNetwork, setChainsByNetwork] = useState({});
  const [networkDropdownOpen, setNetworkDropdownOpen] = useState(false);
  const [addressPickerOpen, setAddressPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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
  const networkDropdownRef = useRef(null);
  const addressPickerRef = useRef(null);

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

  const payoutNetworkItems = useMemo(
    () =>
      networkOptions.map((network) => ({
        network,
        name: getNetworkInfo(network).name,
        balanceLabel: `${formatUsdcBaseUnits(balancesByNetwork[network]?.amount || "0")} USDC`
      })),
    [balancesByNetwork, networkOptions]
  );

  const selectedPayoutNetwork = useMemo(() => {
    if (!payoutNetworkItems.length) {
      return null;
    }
    return payoutNetworkItems.find((item) => item.network === form.network) || payoutNetworkItems[0];
  }, [form.network, payoutNetworkItems]);

  const savedRecipientsForNetwork = useMemo(() => {
    const scoped = addressBookEntries.filter((item) =>
      form.network ? item.network === form.network : false
    );
    return scoped.sort((left, right) =>
      String(left.label || "").localeCompare(String(right.label || ""))
    );
  }, [addressBookEntries, form.network]);

  const loadPayoutData = async (currentAuth) => {
    const query = new URLSearchParams();
    query.set("page", String(page));
    query.set("pageSize", String(pageSize));
    const [payoutsPayload, balancesPayload, chainsPayload, addressBookPayload] = await Promise.all([
      apiWithMerchantKey({
        apiKey: currentAuth.apiKey,
        path: `/v1/merchants/${currentAuth.merchantId}/payouts?${query.toString()}`
      }),
      apiWithMerchantKey({
        apiKey: currentAuth.apiKey,
        path: `/v1/merchants/${currentAuth.merchantId}/balances`
      }),
      apiWithMerchantKey({
        apiKey: currentAuth.apiKey,
        path: "/v1/chains"
      }),
      apiWithMerchantKey({
        apiKey: currentAuth.apiKey,
        path: `/v1/merchants/${currentAuth.merchantId}/payout-addresses`
      })
    ]);

    const nextEvents = payoutsPayload.items || [];
    const nextBalances = Array.isArray(balancesPayload.balances)
      ? balancesPayload.balances.filter(
          (item) => item?.network && String(item.asset || "USDC").toUpperCase() === "USDC"
        )
      : [];
    const spendableBalances = nextBalances.filter((item) => parseBaseUnitsSafe(item.amount) > 0n);
    const nextNetworkOptions = [
      ...new Set(spendableBalances.map((item) => item.network).filter(Boolean))
    ];

    setEvents(nextEvents);
    setPagination(
      payoutsPayload.pagination || {
        page,
        pageSize,
        total: nextEvents.length,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false
      }
    );
    setBalances(nextBalances);
    setNetworkOptions(nextNetworkOptions);
    setAddressBookEntries(Array.isArray(addressBookPayload.items) ? addressBookPayload.items : []);
    setChainsByNetwork(mapChainsByNetwork(chainsPayload.items));
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
    loadPayoutData(auth).catch((nextError) => setError(nextError.message || "Failed to load payouts"));
  }, [auth, page, pageSize]);

  useEffect(() => {
    if (!networkDropdownOpen && !addressPickerOpen) {
      return;
    }

    const handlePointerDown = (event) => {
      const insideNetwork = networkDropdownRef.current?.contains(event.target);
      const insideAddressPicker = addressPickerRef.current?.contains(event.target);
      if (insideNetwork || insideAddressPicker) {
        return;
      }
      setNetworkDropdownOpen(false);
      setAddressPickerOpen(false);
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setNetworkDropdownOpen(false);
        setAddressPickerOpen(false);
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
  }, [addressPickerOpen, networkDropdownOpen]);

  const useSavedAddress = (entry) => {
    setForm((current) => ({
      ...current,
      destinationAddress: entry.address
    }));
    setAddressPickerOpen(false);
  };

  const submitPayout = async (event) => {
    event.preventDefault();
    if (!auth || submitting) {
      return;
    }
    setError("");
    setMessage(null);
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
    if (!isLikelyEvmAddress(form.destinationAddress)) {
      setError("Enter a valid EVM destination address (0x + 40 hex characters).");
      return;
    }
    setSubmitting(true);
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
      const payoutNetwork = String(payout?.network || form.network || "").trim();
      const explorerUrl = buildExplorerTransactionUrl(
        chainsByNetwork[payoutNetwork]?.explorerUrl,
        payout?.txHash
      );
      setMessage({
        status: payout?.status || "submitted",
        txHash: String(payout?.txHash || "").trim(),
        explorerUrl
      });
      setForm((current) => ({
        ...initialForm,
        network: current.network
      }));
      await loadPayoutData(auth);
    } catch (nextError) {
      setError(nextError.message || "Failed to submit payout");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PlatformShell title="Payouts" auth={auth} onLogout={logout}>
      <form className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3.5" onSubmit={submitPayout}>
        <p className="text-base font-semibold">Request payout</p>
        <label className="text-xs text-slate-500">
          From network
          <div className="relative mt-1.5" ref={networkDropdownRef}>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-xl border border-slate-300 bg-white px-3 py-2 text-left text-sm"
              onClick={() => {
                setNetworkDropdownOpen((open) => !open);
                setAddressPickerOpen(false);
              }}
              disabled={!payoutNetworkItems.length}
            >
              {selectedPayoutNetwork ? (
                <span className="inline-flex items-center gap-2">
                  <PayoutNetworkOptionIcon network={selectedPayoutNetwork.network} />
                  <span>
                    {selectedPayoutNetwork.name} · {selectedPayoutNetwork.balanceLabel}
                  </span>
                </span>
              ) : (
                <span className="text-slate-500">Select payout network</span>
              )}
              <span className="text-slate-500">{networkDropdownOpen ? "▴" : "▾"}</span>
            </button>
            {networkDropdownOpen ? (
              <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-300 bg-white p-1 shadow-xl">
                {payoutNetworkItems.map((item) => {
                  const isSelected = item.network === form.network;
                  return (
                    <button
                      key={`payout-network-option-${item.network}`}
                      type="button"
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm ${
                        isSelected
                          ? "bg-rail-50 text-rail-800"
                          : "text-slate-700 hover:bg-slate-100"
                      }`}
                      onClick={() => {
                        setForm((current) => ({ ...current, network: item.network }));
                        setNetworkDropdownOpen(false);
                      }}
                    >
                      <span className="inline-flex items-center gap-2">
                        <PayoutNetworkOptionIcon network={item.network} />
                        <span>{item.name}</span>
                      </span>
                      <span className="text-xs font-medium text-slate-500">{item.balanceLabel}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
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

        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-700">$</span>
          <input
            className="w-full rounded-xl border border-slate-300 bg-white pl-7 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
            placeholder="0"
            value={form.amountUsdc}
            onChange={(event) => setForm((curr) => ({ ...curr, amountUsdc: event.target.value }))}
            required
          />
        </div>
        {insufficientFunds ? <InlineErrorNotice>Amount exceeds available balance for this network.</InlineErrorNotice> : null}

        <label className="text-xs text-slate-500">
          Destination address
          <div className="relative mt-1.5" ref={addressPickerRef}>
            <input
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 pr-12 text-sm text-slate-900 placeholder:text-slate-400"
              placeholder="0x..."
              value={form.destinationAddress}
              onChange={(event) => setForm((curr) => ({ ...curr, destinationAddress: event.target.value }))}
              required
            />
            <button
              type="button"
              onClick={() => {
                setAddressPickerOpen((open) => !open);
                setNetworkDropdownOpen(false);
              }}
              className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              title="Choose from address book"
              aria-label="Choose from address book"
            >
              <AddressBookIcon className="h-4 w-4" />
            </button>
            {addressPickerOpen ? (
              <div className="absolute right-0 z-30 mt-1 w-full max-w-[420px] overflow-hidden rounded-xl border border-slate-300 bg-white shadow-xl">
                <div className="border-b border-slate-200 px-3 py-2">
                  <p className="text-sm font-semibold text-slate-900">Address Book</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {form.network
                      ? `Saved recipients for ${getNetworkInfo(form.network).name}`
                      : "Select a payout network to view matching recipients"}
                  </p>
                </div>
                <div className="max-h-72 overflow-auto p-1">
                  {savedRecipientsForNetwork.length ? (
                    savedRecipientsForNetwork.map((entry) => (
                      <button
                        key={`saved-recipient-${entry.id}`}
                        type="button"
                        className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                        onClick={() => useSavedAddress(entry)}
                      >
                        <PayoutNetworkOptionIcon network={entry.network} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-slate-900">{entry.label}</span>
                          <span className="block break-all font-mono text-[11px] text-slate-500">
                            {entry.address}
                          </span>
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-3 text-sm text-slate-500">
                      <p>
                        {form.network
                          ? "No saved recipients for this network yet."
                          : "Select a payout network first."}
                      </p>
                      <Link
                        href="/address-book"
                        className="mt-2 inline-flex rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        Open Address Book
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </label>

        <button
          className="rounded-xl border border-rail-700 bg-gradient-to-br from-rail-700 to-rail-800 px-3 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-60"
          disabled={submitting || !networkOptions.length || insufficientFunds}
        >
          {submitting ? "Submitting..." : "Submit payout"}
        </button>
      </form>

      {message ? (
        <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Payout {message.status}
          {message.txHash ? (
            <>
              {" · tx "}
              {message.explorerUrl ? (
                <a
                  href={message.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-emerald-300 underline-offset-4 transition hover:text-emerald-900 hover:decoration-emerald-500"
                  title="Open payout transaction in block explorer"
                >
                  {message.txHash}
                </a>
              ) : (
                message.txHash
              )}
            </>
          ) : null}
          .
        </p>
      ) : null}
      {error ? <p className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {!networkOptions.length ? (
        <p className="mt-2 text-xs text-slate-500">No payout-capable network yet. Receive a settlement first.</p>
      ) : null}

      <div className="mt-4">
        <h3 className="text-sm font-semibold text-slate-900">Recent Transactions</h3>
      </div>

      <div className="mt-4 grid gap-2">
        {events.map((item) => {
          const networkKey = String(item.sourceNetwork || item.network || "").trim();
          const network = getNetworkInfo(networkKey);
          const token = getTokenInfo(item.asset || "USDC");
          const payoutExplorerUrl = buildExplorerTransactionUrl(
            chainsByNetwork[networkKey]?.explorerUrl,
            item.txHash
          );
          return (
            <article key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">
                  {formatUsdcBaseUnits(item.amount)} {token.symbol} · {item.status}
                </p>
                <p className="text-xs text-slate-500">{formatDate(item.createdAt)}</p>
              </div>
              <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                {network.logo ? (
                  <img src={network.logo} alt="" className="h-3.5 w-3.5 rounded-full object-contain" />
                ) : null}
                <span>{network.name}</span>
              </p>
              <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                {token.logo ? (
                  <img src={token.logo} alt={token.symbol} className="h-3.5 w-3.5 rounded-full object-contain" />
                ) : null}
                <span>{token.symbol}</span>
              </p>
              <p className="mt-1 break-all font-mono text-xs text-slate-500">
                tx:{" "}
                {item.txHash ? (
                  payoutExplorerUrl ? (
                    <a
                      href={payoutExplorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-600 underline decoration-slate-300 underline-offset-4 transition hover:text-slate-900 hover:decoration-slate-500"
                      title="Open payout transaction in block explorer"
                    >
                      {item.txHash}
                    </a>
                  ) : (
                    item.txHash
                  )
                ) : (
                  "-"
                )}
              </p>
              {item.failReason ? <InlineErrorNotice>Reason: {item.failReason}</InlineErrorNotice> : null}
            </article>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-slate-600">
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
              <option key={`payout-page-size-${size}`} value={size}>
                {size}
              </option>
            ))}
          </select>
          <span>
            Page {pagination.page} of {pagination.totalPages}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={!pagination.hasPreviousPage}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setPage((current) => current + 1)}
            disabled={!pagination.hasNextPage}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </PlatformShell>
  );
}
