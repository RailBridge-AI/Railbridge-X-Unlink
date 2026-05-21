"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PlatformShell from "../../components/console/PlatformShell";
import {
  formatUsdcBaseUnits,
  getNetworkInfo,
  isTestnetNetwork,
  shouldPreferTestnetsInUi
} from "../../lib/assetDisplay";
import { apiWithMerchantKey } from "../../lib/platformClient";
import { useAuthGuard } from "../../lib/useAuthGuard";

const SOURCE_NETWORK_ANY = "any";
const HTTP_METHOD_OPTIONS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const defaultForm = {
  apiId: "",
  apiName: "",
  method: "GET",
  path: "/api/premium",
  amountUsdc: "0.01",
  sourceNetwork: SOURCE_NETWORK_ANY,
  destinationNetwork: "",
  settlementMode: "same_chain"
};

const isSourceAny = (network) => String(network || "").trim().toLowerCase() === SOURCE_NETWORK_ANY;

const sourcePolicyLabel = (network) => {
  if (!network || isSourceAny(network)) {
    return "Any supported USDC network";
  }
  const source = getNetworkInfo(network);
  return source.name;
};

const destinationPolicyLabel = (item) => {
  if (item.settlementMode === "same_chain") {
    return "Keep where payment arrives";
  }
  if (!item.destinationNetwork) {
    return "Treasury default destination";
  }
  const destination = getNetworkInfo(item.destinationNetwork);
  return destination.name;
};

const settlementModeLabel = (mode) =>
  mode === "same_chain" ? "Keep funds where paid" : "Auto-move to treasury";

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

const MethodDropdown = ({
  value,
  onChange,
  open,
  setOpen,
  dropdownRef,
  options,
  disabled = false,
  roundedClassName = "rounded-xl",
  buttonPaddingClassName = "px-3 py-2",
  menuPaddingClassName = "p-1",
  itemPaddingClassName = "px-2 py-1.5"
}) => (
  <div className="relative" ref={dropdownRef}>
    <button
      type="button"
      className={`flex w-full items-center justify-between border border-slate-300 bg-white text-left text-sm text-slate-900 ${roundedClassName} ${buttonPaddingClassName}`}
      onClick={() => setOpen((current) => !current)}
      disabled={disabled}
    >
      <span className="font-medium">{value || "Select method"}</span>
      <span className="text-slate-500">{open ? "▴" : "▾"}</span>
    </button>
    {open ? (
      <div className={`absolute z-30 mt-1 max-h-64 w-full overflow-auto border border-slate-300 bg-white shadow-xl ${roundedClassName} ${menuPaddingClassName}`}>
        {options.map((option) => {
          const isSelected = option === value;
          return (
            <button
              key={`method-option-${option}`}
              type="button"
              className={`flex w-full items-center justify-between rounded-lg text-left text-sm ${itemPaddingClassName} ${
                isSelected
                  ? "bg-rail-50 text-rail-800"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
            >
              <span className="font-medium">{option}</span>
              <span className={`text-xs ${isSelected ? "text-rail-700" : "text-transparent"}`}>
                ✓
              </span>
            </button>
          );
        })}
      </div>
    ) : null}
  </div>
);

export default function ProductsPage() {
  const { auth, logout } = useAuthGuard();
  const [items, setItems] = useState([]);
  const [chainOptions, setChainOptions] = useState([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState(defaultForm);
  const [loading, setLoading] = useState(false);
  const [advancedRouting, setAdvancedRouting] = useState(false);
  const [editingProductId, setEditingProductId] = useState("");
  const [editForm, setEditForm] = useState({
    apiId: "",
    apiName: "",
    method: "GET",
    path: "/api/premium",
    amountUsdc: "",
    sourceNetwork: SOURCE_NETWORK_ANY,
    destinationNetwork: "",
    settlementMode: "same_chain",
    enabled: true
  });
  const [editAdvancedRouting, setEditAdvancedRouting] = useState(false);
  const [actionProductId, setActionProductId] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [showTestnetsOnly, setShowTestnetsOnly] = useState(false);
  const [createMethodDropdownOpen, setCreateMethodDropdownOpen] = useState(false);
  const [editMethodDropdownOpen, setEditMethodDropdownOpen] = useState(false);
  const createMethodDropdownRef = useRef(null);
  const editMethodDropdownRef = useRef(null);

  const sourceSelectOptions = useMemo(
    () => [{ network: SOURCE_NETWORK_ANY, displayName: "Any supported USDC network" }, ...chainOptions],
    [chainOptions]
  );

  const destinationSelectOptions = useMemo(() => {
    if (isSourceAny(form.sourceNetwork)) {
      return chainOptions;
    }
    return chainOptions.filter((chain) => chain.network !== form.sourceNetwork);
  }, [chainOptions, form.sourceNetwork]);

  const editDestinationSelectOptions = useMemo(() => {
    if (isSourceAny(editForm.sourceNetwork)) {
      return chainOptions;
    }
    return chainOptions.filter((chain) => chain.network !== editForm.sourceNetwork);
  }, [chainOptions, editForm.sourceNetwork]);

  const loadProducts = async (currentAuth) => {
    const payload = await apiWithMerchantKey({
      apiKey: currentAuth.apiKey,
      path: `/v1/merchants/${currentAuth.merchantId}/products`
    });
    setItems(payload.items || []);
  };

  const loadChains = async (currentAuth, testnetsOnly) => {
    const payload = await apiWithMerchantKey({
      apiKey: currentAuth.apiKey,
      path: "/v1/chains"
    });
    const availableChains = Array.isArray(payload.items)
      ? payload.items
          .filter((item) => item?.network && item.status !== "paused")
      : [];
    const visibleChains = testnetsOnly
      ? availableChains.filter((item) => isTestnetNetwork(item.network))
      : availableChains;
    visibleChains.sort((a, b) =>
      String(a.displayName || a.network).localeCompare(String(b.displayName || b.network))
    );
    setChainOptions(visibleChains);
  };

  useEffect(() => {
    setShowTestnetsOnly(shouldPreferTestnetsInUi());
  }, []);

  useEffect(() => {
    if (!auth) {
      return;
    }
    Promise.all([loadProducts(auth), loadChains(auth, showTestnetsOnly)]).catch((nextError) =>
      setError(nextError.message || "Failed to load products")
    );
  }, [auth, showTestnetsOnly]);

  useEffect(() => {
    if (!createMethodDropdownOpen && !editMethodDropdownOpen) {
      return;
    }

    const handlePointerDown = (event) => {
      const insideCreate = createMethodDropdownRef.current?.contains(event.target);
      const insideEdit = editMethodDropdownRef.current?.contains(event.target);
      if (insideCreate || insideEdit) {
        return;
      }
      setCreateMethodDropdownOpen(false);
      setEditMethodDropdownOpen(false);
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setCreateMethodDropdownOpen(false);
        setEditMethodDropdownOpen(false);
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
  }, [createMethodDropdownOpen, editMethodDropdownOpen]);

  const createProduct = async (event) => {
    event.preventDefault();
    if (!auth) {
      return;
    }

    const sourceNetwork = advancedRouting ? form.sourceNetwork : SOURCE_NETWORK_ANY;
    const settlementMode = advancedRouting ? form.settlementMode : "same_chain";
    const destinationNetwork =
      settlementMode === "cross_chain" && advancedRouting ? form.destinationNetwork || null : null;

    setLoading(true);
    setError("");
    try {
      await apiWithMerchantKey({
        apiKey: auth.apiKey,
        path: `/v1/merchants/${auth.merchantId}/products`,
        method: "POST",
        body: {
          apiId: form.apiId,
          apiName: form.apiName,
          method: form.method,
          path: form.path,
          amountUsdc: form.amountUsdc,
          sourceNetwork,
          destinationNetwork,
          settlementMode
        }
      });
      setForm(defaultForm);
      setAdvancedRouting(false);
      setCreateMethodDropdownOpen(false);
      await loadProducts(auth);
    } catch (nextError) {
      setError(nextError.message || "Failed to create product");
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (item) => {
    const hasCustomRouting =
      !isSourceAny(item.sourceNetwork) ||
      item.settlementMode === "cross_chain" ||
      Boolean(item.destinationNetwork);
    setEditingProductId(item.id);
    setEditAdvancedRouting(hasCustomRouting);
    setEditMethodDropdownOpen(false);
    setEditForm({
      apiId: item.apiId || "",
      apiName: item.apiName || "",
      method: item.method || "GET",
      path: item.path || "/",
      amountUsdc: baseUnitsToUsdcInput(item.amount),
      sourceNetwork: item.sourceNetwork || SOURCE_NETWORK_ANY,
      destinationNetwork: item.destinationNetwork || "",
      settlementMode: item.settlementMode || "same_chain",
      enabled: Boolean(item.enabled)
    });
  };

  const cancelEdit = () => {
    setEditingProductId("");
    setEditMethodDropdownOpen(false);
    setEditForm({
      apiId: "",
      apiName: "",
      method: "GET",
      path: "/api/premium",
      amountUsdc: "",
      sourceNetwork: SOURCE_NETWORK_ANY,
      destinationNetwork: "",
      settlementMode: "same_chain",
      enabled: true
    });
    setEditAdvancedRouting(false);
  };

  const saveEdit = async (productId) => {
    if (!auth) {
      return;
    }
    setError("");
    setActionProductId(productId);
    setActionBusy(true);
    try {
      const sourceNetwork = editAdvancedRouting ? editForm.sourceNetwork : SOURCE_NETWORK_ANY;
      const settlementMode = editAdvancedRouting ? editForm.settlementMode : "same_chain";
      const destinationNetwork = settlementMode === "cross_chain" ? editForm.destinationNetwork || null : null;

      await apiWithMerchantKey({
        apiKey: auth.apiKey,
        path: `/v1/merchants/${auth.merchantId}/products/${productId}`,
        method: "PUT",
        body: {
          apiId: editForm.apiId,
          apiName: editForm.apiName,
          method: editForm.method,
          path: editForm.path,
          amountUsdc: editForm.amountUsdc,
          sourceNetwork,
          destinationNetwork,
          settlementMode,
          enabled: editForm.enabled
        }
      });
      cancelEdit();
      await loadProducts(auth);
    } catch (nextError) {
      setError(nextError.message || "Failed to update product");
    } finally {
      setActionBusy(false);
      setActionProductId("");
    }
  };

  const removeProduct = async (item) => {
    if (!auth) {
      return;
    }
    const approved = window.confirm(`Delete product "${item.apiName}" (${item.method} ${item.path})?`);
    if (!approved) {
      return;
    }
    setError("");
    setActionProductId(item.id);
    setActionBusy(true);
    try {
      await apiWithMerchantKey({
        apiKey: auth.apiKey,
        path: `/v1/merchants/${auth.merchantId}/products/${item.id}`,
        method: "DELETE"
      });
      if (editingProductId === item.id) {
        cancelEdit();
      }
      await loadProducts(auth);
    } catch (nextError) {
      setError(nextError.message || "Failed to delete product");
    } finally {
      setActionBusy(false);
      setActionProductId("");
    }
  };

  return (
    <PlatformShell title="Products" auth={auth} onLogout={logout}>
      <form className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3.5" onSubmit={createProduct}>
        <p className="text-base font-semibold">Create Product</p>
        <p className="text-xs text-slate-500">
          Simplicity default: accept USDC from any active supported network and keep funds on the source chain.
        </p>

        <input
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
          placeholder="API ID"
          value={form.apiId}
          onChange={(event) => setForm((curr) => ({ ...curr, apiId: event.target.value }))}
          required
        />
        <p className="text-[11px] text-slate-500">
          API ID is your internal identifier for this paid endpoint. Use a unique value per product.
        </p>
        <input
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
          placeholder="API Name"
          value={form.apiName}
          onChange={(event) => setForm((curr) => ({ ...curr, apiName: event.target.value }))}
          required
        />
        <div className="grid gap-2 md:grid-cols-2">
          <MethodDropdown
            value={form.method}
            onChange={(method) => setForm((curr) => ({ ...curr, method }))}
            open={createMethodDropdownOpen}
            setOpen={(nextValue) => {
              setEditMethodDropdownOpen(false);
              setCreateMethodDropdownOpen(nextValue);
            }}
            dropdownRef={createMethodDropdownRef}
            options={HTTP_METHOD_OPTIONS}
          />
          <input
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            placeholder="Path"
            value={form.path}
            onChange={(event) => setForm((curr) => ({ ...curr, path: event.target.value }))}
            required
          />
        </div>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-700">$</span>
          <input
            className="w-full rounded-xl border border-slate-300 bg-white pl-7 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
            placeholder="0.01"
            value={form.amountUsdc}
            onChange={(event) => setForm((curr) => ({ ...curr, amountUsdc: event.target.value }))}
            required
          />
        </div>

        <label className="mt-1 inline-flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={advancedRouting}
            onChange={(event) => setAdvancedRouting(event.target.checked)}
          />
          Advanced settlement routing (optional)
        </label>

        {advancedRouting ? (
          <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-2.5 md:grid-cols-3">
            <label className="grid gap-1 text-xs text-slate-600">
              Accept from
              <select
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                value={form.sourceNetwork}
                onChange={(event) => setForm((current) => ({ ...current, sourceNetwork: event.target.value }))}
              >
                {sourceSelectOptions.map((chain) => (
                  <option key={`source-option-${chain.network}`} value={chain.network}>
                    {chain.displayName || chain.network}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-xs text-slate-600">
              Settlement
              <select
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                value={form.settlementMode}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    settlementMode: event.target.value,
                    destinationNetwork:
                      event.target.value === "same_chain" ? "" : current.destinationNetwork
                  }))
                }
              >
                <option value="same_chain">Keep funds where payment arrives</option>
                <option value="cross_chain">Auto-move to treasury network</option>
              </select>
            </label>

            <label className="grid gap-1 text-xs text-slate-600">
              Destination
              <select
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                value={form.destinationNetwork}
                onChange={(event) => setForm((current) => ({ ...current, destinationNetwork: event.target.value }))}
                disabled={form.settlementMode !== "cross_chain"}
              >
                <option value="">Use treasury default</option>
                {destinationSelectOptions.map((chain) => (
                  <option key={`destination-option-${chain.network}`} value={chain.network}>
                    {chain.displayName || chain.network}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="rounded-xl border border-rail-700 bg-gradient-to-br from-rail-700 to-rail-800 px-3 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-60"
        >
          {loading ? "Creating..." : "Create product"}
        </button>
      </form>

      {error ? (
        <p className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      <div className="mt-4 grid gap-2">
        {!items.length ? (
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
            No products yet. Create your first paid route to start accepting payments.
          </p>
        ) : null}
        {items.map((item) => (
          <article key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{item.apiName}</p>
                <p className="text-xs text-slate-500">{item.method} {item.path}</p>
                <p className="text-xs text-slate-500">API ID: {item.apiId}</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${item.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"}`}>
                {item.enabled ? "Active" : "Disabled"}
              </span>
            </div>
            <p className="mt-1">
              {formatUsdcBaseUnits(item.amount)} USDC · {settlementModeLabel(item.settlementMode)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {sourcePolicyLabel(item.sourceNetwork)} {" -> "} {destinationPolicyLabel(item)}
            </p>

            {editingProductId === item.id ? (
              <div className="mt-3 grid gap-2 rounded-xl border border-slate-200 bg-white p-2.5">
                <input
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                  value={editForm.apiId}
                  onChange={(event) => setEditForm((current) => ({ ...current, apiId: event.target.value }))}
                  placeholder="API ID"
                  required
                />
                <p className="text-[11px] text-slate-500">
                  API ID must stay unique in your merchant account.
                </p>
                <input
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                  value={editForm.apiName}
                  onChange={(event) => setEditForm((current) => ({ ...current, apiName: event.target.value }))}
                  placeholder="API name"
                  required
                />
                <div className="grid gap-2 md:grid-cols-2">
                  <MethodDropdown
                    value={editForm.method}
                    onChange={(method) => setEditForm((current) => ({ ...current, method }))}
                    open={editMethodDropdownOpen}
                    setOpen={(nextValue) => {
                      setCreateMethodDropdownOpen(false);
                      setEditMethodDropdownOpen(nextValue);
                    }}
                    dropdownRef={editMethodDropdownRef}
                    options={HTTP_METHOD_OPTIONS}
                    roundedClassName="rounded-lg"
                    buttonPaddingClassName="px-2.5 py-1.5"
                    menuPaddingClassName="p-1"
                    itemPaddingClassName="px-2 py-1.5"
                  />
                  <input
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                    value={editForm.path}
                    onChange={(event) => setEditForm((current) => ({ ...current, path: event.target.value }))}
                    placeholder="/api/route"
                    required
                  />
                </div>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-700">$</span>
                  <input
                    className="w-full rounded-lg border border-slate-300 bg-white pl-7 pr-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400"
                    value={editForm.amountUsdc}
                    onChange={(event) => setEditForm((current) => ({ ...current, amountUsdc: event.target.value }))}
                    placeholder="0.01"
                    required
                  />
                </div>
                <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={editAdvancedRouting}
                    onChange={(event) => setEditAdvancedRouting(event.target.checked)}
                  />
                  Edit advanced settlement routing
                </label>
                {editAdvancedRouting ? (
                  <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 md:grid-cols-3">
                    <label className="grid gap-1 text-xs text-slate-600">
                      Accept from
                      <select
                        className="rounded border border-slate-300 bg-white px-2 py-1"
                        value={editForm.sourceNetwork}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            sourceNetwork: event.target.value,
                            destinationNetwork:
                              current.destinationNetwork === event.target.value ? "" : current.destinationNetwork
                          }))
                        }
                      >
                        {sourceSelectOptions.map((chain) => (
                          <option key={`edit-source-${item.id}-${chain.network}`} value={chain.network}>
                            {chain.displayName || chain.network}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-xs text-slate-600">
                      Settlement
                      <select
                        className="rounded border border-slate-300 bg-white px-2 py-1"
                        value={editForm.settlementMode}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            settlementMode: event.target.value,
                            destinationNetwork: event.target.value === "same_chain" ? "" : current.destinationNetwork
                          }))
                        }
                      >
                        <option value="same_chain">Keep funds where payment arrives</option>
                        <option value="cross_chain">Auto-move to treasury network</option>
                      </select>
                    </label>
                    <label className="grid gap-1 text-xs text-slate-600">
                      Destination
                      <select
                        className="rounded border border-slate-300 bg-white px-2 py-1 disabled:bg-slate-100"
                        value={editForm.destinationNetwork}
                        onChange={(event) =>
                          setEditForm((current) => ({ ...current, destinationNetwork: event.target.value }))
                        }
                        disabled={editForm.settlementMode !== "cross_chain"}
                      >
                        <option value="">Use treasury default</option>
                        {editDestinationSelectOptions.map((chain) => (
                          <option key={`edit-destination-${item.id}-${chain.network}`} value={chain.network}>
                            {chain.displayName || chain.network}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : null}
                <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={editForm.enabled}
                    onChange={(event) => setEditForm((current) => ({ ...current, enabled: event.target.checked }))}
                  />
                  Product is active
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => saveEdit(item.id)}
                    disabled={actionBusy && actionProductId === item.id}
                    className="rounded-lg border border-rail-700 bg-rail-700 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    {actionBusy && actionProductId === item.id ? "Saving..." : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    disabled={actionBusy && actionProductId === item.id}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs hover:bg-slate-100 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => removeProduct(item)}
                    disabled={actionBusy && actionProductId === item.id}
                    className="rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                  >
                    {actionBusy && actionProductId === item.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(item)}
                  disabled={actionBusy && actionProductId === item.id}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs hover:bg-slate-100 disabled:opacity-60"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => removeProduct(item)}
                  disabled={actionBusy && actionProductId === item.id}
                  className="rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                >
                  {actionBusy && actionProductId === item.id ? "Deleting..." : "Delete"}
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </PlatformShell>
  );
}
