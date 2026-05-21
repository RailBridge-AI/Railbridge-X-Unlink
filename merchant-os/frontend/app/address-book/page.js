"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PlatformShell from "../../components/console/PlatformShell";
import { apiWithMerchantKey } from "../../lib/platformClient";
import { useAuthGuard } from "../../lib/useAuthGuard";
import {
  getNetworkInfo,
  isTestnetNetwork,
  shouldPreferTestnetsInUi
} from "../../lib/assetDisplay";

const initialForm = {
  id: "",
  label: "",
  network: "",
  address: ""
};

const formatDate = (value) => {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const AddressBookNetworkOptionIcon = ({ network }) => {
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

export default function AddressBookPage() {
  const { auth, logout } = useAuthGuard();
  const [entries, setEntries] = useState([]);
  const [chainOptions, setChainOptions] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showTestnetsOnly, setShowTestnetsOnly] = useState(false);
  const [networkDropdownOpen, setNetworkDropdownOpen] = useState(false);
  const networkDropdownRef = useRef(null);

  const visibleEntries = useMemo(() => {
    const scopedEntries = showTestnetsOnly
      ? entries.filter((item) => isTestnetNetwork(item.network))
      : entries;
    return [...scopedEntries].sort((left, right) => {
      const leftDate = String(left.lastUsedAt || left.createdAt || "");
      const rightDate = String(right.lastUsedAt || right.createdAt || "");
      return rightDate.localeCompare(leftDate);
    });
  }, [entries, showTestnetsOnly]);

  const networkItems = useMemo(
    () =>
      chainOptions.map((chain) => ({
        network: chain.network,
        name: chain.displayName || getNetworkInfo(chain.network).name
      })),
    [chainOptions]
  );

  const selectedNetwork = useMemo(() => {
    if (!networkItems.length) {
      return null;
    }
    return networkItems.find((item) => item.network === form.network) || networkItems[0];
  }, [form.network, networkItems]);

  const loadAddressBook = async (currentAuth, testnetsOnly) => {
    const [entriesPayload, chainsPayload] = await Promise.all([
      apiWithMerchantKey({
        apiKey: currentAuth.apiKey,
        path: `/v1/merchants/${currentAuth.merchantId}/payout-addresses`
      }),
      apiWithMerchantKey({
        apiKey: currentAuth.apiKey,
        path: "/v1/chains"
      })
    ]);

    const activeChains = Array.isArray(chainsPayload.items)
      ? chainsPayload.items.filter((item) => item?.network && item.status !== "paused")
      : [];
    const visibleChains = testnetsOnly
      ? activeChains.filter((item) => isTestnetNetwork(item.network))
      : activeChains;
    visibleChains.sort((left, right) =>
      String(left.displayName || left.network).localeCompare(String(right.displayName || right.network))
    );

    setEntries(Array.isArray(entriesPayload.items) ? entriesPayload.items : []);
    setChainOptions(visibleChains);
    setForm((current) => ({
      ...current,
      network:
        current.network && visibleChains.some((item) => item.network === current.network)
          ? current.network
          : visibleChains[0]?.network || ""
    }));
  };

  useEffect(() => {
    setShowTestnetsOnly(shouldPreferTestnetsInUi());
  }, []);

  useEffect(() => {
    if (!auth) {
      return;
    }
    loadAddressBook(auth, showTestnetsOnly).catch((nextError) =>
      setError(nextError.message || "Failed to load address book")
    );
  }, [auth, showTestnetsOnly]);

  useEffect(() => {
    if (!networkDropdownOpen) {
      return;
    }

    const handlePointerDown = (event) => {
      if (!networkDropdownRef.current?.contains(event.target)) {
        setNetworkDropdownOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setNetworkDropdownOpen(false);
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
  }, [networkDropdownOpen]);

  const resetForm = () => {
    setForm((current) => ({
      ...initialForm,
      network: current.network || chainOptions[0]?.network || ""
    }));
  };

  const saveEntry = async (event) => {
    event.preventDefault();
    if (!auth || busy) {
      return;
    }

    const label = String(form.label || "").trim();
    const network = String(form.network || "").trim();
    const address = String(form.address || "").trim();

    setError("");
    setMessage("");

    if (label.length < 2) {
      setError("Recipient label must be at least 2 characters.");
      return;
    }
    if (!network) {
      setError("Choose a network for this saved recipient.");
      return;
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      setError("Enter a valid EVM wallet address.");
      return;
    }

    setBusy(true);
    try {
      if (form.id) {
        await apiWithMerchantKey({
          apiKey: auth.apiKey,
          path: `/v1/merchants/${auth.merchantId}/payout-addresses/${form.id}`,
          method: "PUT",
          body: {
            label,
            network,
            address
          }
        });
        setMessage("Saved recipient updated.");
      } else {
        await apiWithMerchantKey({
          apiKey: auth.apiKey,
          path: `/v1/merchants/${auth.merchantId}/payout-addresses`,
          method: "POST",
          body: {
            label,
            network,
            address
          }
        });
        setMessage("Saved recipient added.");
      }
      resetForm();
      await loadAddressBook(auth, showTestnetsOnly);
    } catch (nextError) {
      setError(nextError.message || "Failed to save recipient");
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (entry) => {
    setError("");
    setMessage("");
    setForm({
      id: entry.id,
      label: entry.label || "",
      network: entry.network || "",
      address: entry.address || ""
    });
    setNetworkDropdownOpen(false);
  };

  const removeEntry = async (entry) => {
    if (!auth || busy) {
      return;
    }
    const approved = window.confirm(`Delete saved recipient "${entry.label}"?`);
    if (!approved) {
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiWithMerchantKey({
        apiKey: auth.apiKey,
        path: `/v1/merchants/${auth.merchantId}/payout-addresses/${entry.id}`,
        method: "DELETE"
      });
      if (form.id === entry.id) {
        resetForm();
      }
      setMessage("Saved recipient deleted.");
      await loadAddressBook(auth, showTestnetsOnly);
    } catch (nextError) {
      setError(nextError.message || "Failed to delete recipient");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PlatformShell title="Address Book" auth={auth} onLogout={logout}>
      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-base font-semibold">Saved payout recipients</p>
            <p className="mt-1 text-xs text-slate-500">
              Manage reusable recipient addresses here. These appear from the address-book icon inside the payout form.
            </p>
          </div>
          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600">
            {visibleEntries.length} recipient{visibleEntries.length === 1 ? "" : "s"}
          </span>
        </div>

        <form className="mt-3 grid gap-2 rounded-xl border border-slate-200 bg-white p-3" onSubmit={saveEntry}>
          <div className="grid gap-2 md:grid-cols-3">
            <input
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              placeholder="Recipient label"
              value={form.label}
              onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
              required
            />
            <div className="relative" ref={networkDropdownRef}>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-xl border border-slate-300 bg-white px-3 py-2 text-left text-sm"
                onClick={() => setNetworkDropdownOpen((open) => !open)}
                disabled={!networkItems.length}
              >
                {selectedNetwork ? (
                  <span className="inline-flex items-center gap-2">
                    <AddressBookNetworkOptionIcon network={selectedNetwork.network} />
                    <span>{selectedNetwork.name}</span>
                  </span>
                ) : (
                  <span className="text-slate-500">Select network</span>
                )}
                <span className="text-slate-500">{networkDropdownOpen ? "▴" : "▾"}</span>
              </button>
              {networkDropdownOpen ? (
                <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-300 bg-white p-1 shadow-xl">
                  {networkItems.map((item) => {
                    const isSelected = item.network === form.network;
                    return (
                      <button
                        key={`address-book-network-option-${item.network}`}
                        type="button"
                        className={`flex w-full items-center rounded-lg px-2 py-1.5 text-left text-sm ${
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
                          <AddressBookNetworkOptionIcon network={item.network} />
                          <span>{item.name}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <input
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              placeholder="0x..."
              value={form.address}
              onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
              required
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg border border-rail-700 bg-rail-700 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              {busy ? "Saving..." : form.id ? "Save changes" : "Save recipient"}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs hover:bg-slate-100"
            >
              {form.id ? "Cancel edit" : "Clear"}
            </button>
          </div>
        </form>
      </section>

      {message ? (
        <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <div className="mt-4 grid gap-2">
        {visibleEntries.length ? (
          visibleEntries.map((entry) => {
            const network = getNetworkInfo(entry.network);
            return (
              <article key={entry.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{entry.label}</p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                      {network.logo ? (
                        <img src={network.logo} alt="" className="h-3.5 w-3.5 rounded-full object-contain" />
                      ) : null}
                      <span>{network.name}</span>
                    </p>
                    <p className="mt-1 font-mono text-xs text-slate-500">{entry.address}</p>
                  </div>
                  <div className="text-right text-[11px] text-slate-500">
                    <p>Last used: {formatDate(entry.lastUsedAt)}</p>
                    <p className="mt-1">Saved: {formatDate(entry.createdAt)}</p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => startEdit(entry)}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs hover:bg-slate-100"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => removeEntry(entry)}
                    disabled={busy}
                    className="rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                  >
                    Delete
                  </button>
                </div>
              </article>
            );
          })
        ) : (
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
            No saved recipients yet. Add one above, then use it later from the address-book icon in Payouts.
          </p>
        )}
      </div>
    </PlatformShell>
  );
}
