"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PlatformShell from "../../components/console/PlatformShell";
import SyntaxCodeBlock from "../../components/console/SyntaxCodeBlock";
import {
  getNetworkInfo,
  isTestnetNetwork,
  shouldPreferTestnetsInUi
} from "../../lib/assetDisplay";
import { apiWithSession } from "../../lib/platformClient";
import { useAuthGuard } from "../../lib/useAuthGuard";

const SAME_CHAIN_POLICY_NETWORK = "same_chain";
const SAME_CHAIN_POLICY_LABEL = "Same as payment source chain (stay on source)";
const generateWebhookSigningSecret = () => {
  const bytes = new Uint8Array(24);
  window.crypto.getRandomValues(bytes);
  const value = Array.from(bytes, (item) =>
    String.fromCharCode(item)
  ).join("");
  return `whsec_${btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`;
};
const maskSecretValue = (value) => {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (text.length <= 10) {
    return `${text.slice(0, 2)}...${text.slice(-2)}`;
  }
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
};

const PolicyNetworkOptionIcon = ({ network, displayName }) => {
  if (network === SAME_CHAIN_POLICY_NETWORK) {
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-[10px] font-semibold text-slate-700">
        ↔
      </span>
    );
  }

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

  const initials = String(displayName || network || "N")
    .trim()
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-[10px] font-semibold text-slate-700">
      {initials}
    </span>
  );
};

const EXPRESS_WEBHOOK_SNIPPET = `import express from "express";
import { verifyWebhook } from "@railbridge/sdk";

const app = express();

// Keep raw JSON string for signature verification
app.use("/webhooks/railbridge", express.text({ type: "application/json" }));

app.post("/webhooks/railbridge", (req, res) => {
  const signature = req.header("x-railbridge-signature");
  const timestamp = req.header("x-railbridge-timestamp");
  const body = req.body;

  const ok = verifyWebhook({
    secret: process.env.RB_WEBHOOK_SECRET,
    timestamp,
    payload: body,
    signature
  });

  if (!ok) {
    return res.status(401).json({ error: "invalid signature" });
  }

  const event = JSON.parse(body);
  // Handle event.type here
  return res.status(200).json({ ok: true });
});`;

const NEXT_WEBHOOK_SNIPPET = `import { verifyWebhook } from "@railbridge/sdk";

export async function POST(req) {
  const body = await req.text();
  const signature = req.headers.get("x-railbridge-signature");
  const timestamp = req.headers.get("x-railbridge-timestamp");

  const ok = verifyWebhook({
    secret: process.env.RB_WEBHOOK_SECRET,
    timestamp,
    payload: body,
    signature
  });

  if (!ok) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(body);
  // Handle event.type here
  return Response.json({ ok: true });
}`;

export default function SettingsPage() {
  const { auth, logout } = useAuthGuard();
  const [settings, setSettings] = useState(null);
  const [apiKeyName, setApiKeyName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [lastSecret, setLastSecret] = useState("");
  const [lastApiKeyToken, setLastApiKeyToken] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const [snippetView, setSnippetView] = useState("express");
  const [settingsPanel, setSettingsPanel] = useState("api_keys");
  const [editingKeyId, setEditingKeyId] = useState("");
  const [editKeyName, setEditKeyName] = useState("");
  const [editKeyRole, setEditKeyRole] = useState("readonly");
  const [busyKeyId, setBusyKeyId] = useState("");
  const [editingWebhookId, setEditingWebhookId] = useState("");
  const [editWebhookUrl, setEditWebhookUrl] = useState("");
  const [busyWebhookId, setBusyWebhookId] = useState("");
  const [apiKeyCreateBusy, setApiKeyCreateBusy] = useState(false);
  const [webhookTestBusy, setWebhookTestBusy] = useState(false);
  const [treasuryPreferredNetwork, setTreasuryPreferredNetwork] = useState("");
  const [treasuryAutoBridgeEnabled, setTreasuryAutoBridgeEnabled] = useState(true);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [showTestnetsOnly, setShowTestnetsOnly] = useState(false);
  const [showRevokedApiKeys, setShowRevokedApiKeys] = useState(false);
  const [policyDropdownOpen, setPolicyDropdownOpen] = useState(false);
  const [pendingRevokedApiKeyDelete, setPendingRevokedApiKeyDelete] = useState(null);
  const policyDropdownRef = useRef(null);
  const isCurrentConsoleKey = (item) => {
    const currentApiKey = String(auth?.apiKey || "").trim();
    const keyPrefix = String(item?.keyPrefix || "").trim();
    if (!currentApiKey || !keyPrefix) {
      return false;
    }
    return currentApiKey.startsWith(keyPrefix);
  };

  const loadSettings = async (currentAuth) => {
    const payload = await apiWithSession({
      token: currentAuth.token,
      path: "/v1/onboarding/settings"
    });
    setSettings(payload);
  };

  useEffect(() => {
    if (!auth) {
      return;
    }
    loadSettings(auth).catch((nextError) => setError(nextError.message || "Failed to load settings"));
  }, [auth]);

  useEffect(() => {
    if (!lastApiKeyToken) {
      return;
    }
    const timer = setTimeout(() => setLastApiKeyToken(""), 5 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [lastApiKeyToken]);

  useEffect(() => {
    if (!lastSecret) {
      return;
    }
    const timer = setTimeout(() => setLastSecret(""), 5 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [lastSecret]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const params = new URLSearchParams(window.location.search || "");
    const panel = String(params.get("panel") || "").trim().toLowerCase();
    if (panel === "api_keys" || panel === "webhooks" || panel === "treasury") {
      setSettingsPanel(panel);
    }
  }, []);

  useEffect(() => {
    setShowTestnetsOnly(shouldPreferTestnetsInUi());
  }, []);

  useEffect(() => {
    if (!settings) {
      return;
    }
    if (settings.policy?.preferredNetwork) {
      setTreasuryPreferredNetwork(String(settings.policy.preferredNetwork));
    }
    setTreasuryAutoBridgeEnabled(Boolean(settings.policy?.autoBridgeEnabled ?? true));
  }, [settings]);

  const policyChainOptions = useMemo(() => {
    const chains = Array.isArray(settings?.chains) ? settings.chains : [];
    const activeChains = chains.filter((chain) => chain?.network && chain.status !== "paused");
    const visibleChains = showTestnetsOnly
      ? activeChains.filter((chain) => isTestnetNetwork(chain.network))
      : activeChains;
    const sortedChains = [...visibleChains].sort((left, right) => {
      const leftName = String(left.displayName || getNetworkInfo(left.network).name || left.network);
      const rightName = String(right.displayName || getNetworkInfo(right.network).name || right.network);
      return leftName.localeCompare(rightName);
    });
    return [
      {
        network: SAME_CHAIN_POLICY_NETWORK,
        displayName: SAME_CHAIN_POLICY_LABEL
      },
      ...sortedChains
    ];
  }, [settings, showTestnetsOnly]);

  const selectedPolicyOption = useMemo(() => {
    if (!policyChainOptions.length) {
      return null;
    }
    return (
      policyChainOptions.find((chain) => chain.network === treasuryPreferredNetwork) ||
      policyChainOptions[0]
    );
  }, [policyChainOptions, treasuryPreferredNetwork]);

  useEffect(() => {
    if (!policyChainOptions.length) {
      return;
    }
    if (!treasuryPreferredNetwork) {
      setTreasuryPreferredNetwork(policyChainOptions[0].network);
      return;
    }
    const exists = policyChainOptions.some((chain) => chain.network === treasuryPreferredNetwork);
    if (!exists) {
      setTreasuryPreferredNetwork(policyChainOptions[0].network);
    }
  }, [policyChainOptions, treasuryPreferredNetwork]);

  useEffect(() => {
    if (!policyDropdownOpen) {
      return;
    }

    const handlePointerDown = (event) => {
      if (!policyDropdownRef.current) {
        return;
      }
      if (!policyDropdownRef.current.contains(event.target)) {
        setPolicyDropdownOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setPolicyDropdownOpen(false);
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
  }, [policyDropdownOpen]);

  const copyText = async (id, value) => {
    try {
      await navigator.clipboard.writeText(String(value || ""));
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(""), 1200);
    } catch {
      setError("Clipboard copy failed. Copy manually from the value.");
    }
  };

  const addWebhook = async (event) => {
    event.preventDefault();
    if (!auth) {
      return;
    }
    setError("");
    setMessage("");
    try {
      const signingSecret = generateWebhookSigningSecret();
      await apiWithSession({
        token: auth.token,
        path: "/v1/onboarding/webhooks",
        method: "POST",
        body: { url: webhookUrl, signingSecret }
      });
      setLastSecret(signingSecret);
      setWebhookUrl("");
      setMessage("Webhook endpoint created.");
      await loadSettings(auth);
    } catch (nextError) {
      setError(nextError.message || "Failed to create webhook");
    }
  };

  const createApiKeyAction = async (event) => {
    event.preventDefault();
    if (!auth || apiKeyCreateBusy) {
      return;
    }
    setError("");
    setMessage("");
    setApiKeyCreateBusy(true);
    try {
      const payload = await apiWithSession({
        token: auth.token,
        path: "/v1/onboarding/api-keys",
        method: "POST",
        body: {
          name: apiKeyName.trim() || undefined
        }
      });
      setApiKeyName("");
      setLastApiKeyToken(payload.token || "");
      setMessage("API key created.");
      await loadSettings(auth);
    } catch (nextError) {
      setError(nextError.message || "Failed to create API key");
    } finally {
      setApiKeyCreateBusy(false);
    }
  };

  const startEditKey = (item) => {
    setEditingKeyId(item.id);
    setEditKeyName(item.name || "");
    setEditKeyRole(item.role || "readonly");
  };

  const cancelEditKey = () => {
    setEditingKeyId("");
    setEditKeyName("");
    setEditKeyRole("readonly");
  };

  const saveKeyEdits = async (event) => {
    event.preventDefault();
    if (!auth || !editingKeyId) {
      return;
    }
    setError("");
    setMessage("");
    setBusyKeyId(editingKeyId);
    try {
      await apiWithSession({
        token: auth.token,
        path: `/v1/onboarding/api-keys/${editingKeyId}`,
        method: "PATCH",
        body: {
          name: editKeyName,
          role: editKeyRole
        }
      });
      setMessage("API key updated.");
      cancelEditKey();
      await loadSettings(auth);
    } catch (nextError) {
      setError(nextError.message || "Failed to update API key");
    } finally {
      setBusyKeyId("");
    }
  };

  const revokeApiKeyAction = async (item) => {
    if (!auth) {
      return;
    }
    const isCurrentConsoleKeyMatch = isCurrentConsoleKey(item);
    const confirmed = window.confirm(
      isCurrentConsoleKeyMatch
        ? "This is the current console API key. Revoking it can break API-key based requests until you log in again. Revoke anyway?"
        : `Revoke API key "${item.name}"? This cannot be undone.`
    );
    if (!confirmed) {
      return;
    }
    setError("");
    setMessage("");
    setBusyKeyId(item.id);
    try {
      await apiWithSession({
        token: auth.token,
        path: `/v1/onboarding/api-keys/${item.id}/revoke`,
        method: "POST"
      });
      setMessage("API key revoked.");
      if (editingKeyId === item.id) {
        cancelEditKey();
      }
      if (isCurrentConsoleKeyMatch) {
        logout();
        return;
      }
      await loadSettings(auth);
    } catch (nextError) {
      setError(nextError.message || "Failed to revoke API key");
    } finally {
      setBusyKeyId("");
    }
  };

  const openDeleteRevokedApiKeyModal = (item) => {
    setPendingRevokedApiKeyDelete(item);
  };

  const closeDeleteRevokedApiKeyModal = () => {
    if (busyKeyId && pendingRevokedApiKeyDelete?.id === busyKeyId) {
      return;
    }
    setPendingRevokedApiKeyDelete(null);
  };

  const confirmDeleteRevokedApiKey = async () => {
    if (!auth || !pendingRevokedApiKeyDelete) {
      return;
    }
    const item = pendingRevokedApiKeyDelete;
    setError("");
    setMessage("");
    setBusyKeyId(item.id);
    try {
      await apiWithSession({
        token: auth.token,
        path: `/v1/onboarding/api-keys/${item.id}`,
        method: "DELETE"
      });
      if (editingKeyId === item.id) {
        cancelEditKey();
      }
      setMessage("Revoked API key removed.");
      setPendingRevokedApiKeyDelete(null);
      await loadSettings(auth);
    } catch (nextError) {
      setError(nextError.message || "Failed to delete revoked API key");
    } finally {
      setBusyKeyId("");
    }
  };

  const testWebhooks = async () => {
    if (!auth || webhookTestBusy) {
      return;
    }
    setError("");
    setMessage("");
    setWebhookTestBusy(true);
    try {
      const payload = await apiWithSession({
        token: auth.token,
        path: "/v1/onboarding/webhooks/test",
        method: "POST"
      });
      setMessage(`Test sent: ${payload.acknowledged}/${payload.sent} acknowledged`);
      await loadSettings(auth);
    } catch (nextError) {
      setError(nextError.message || "Failed to send webhook test");
    } finally {
      setWebhookTestBusy(false);
    }
  };

  const startEditWebhook = (item) => {
    setEditingWebhookId(item.id);
    setEditWebhookUrl(item.url || "");
  };

  const cancelEditWebhook = () => {
    setEditingWebhookId("");
    setEditWebhookUrl("");
  };

  const saveWebhookEdits = async (event) => {
    event.preventDefault();
    if (!auth || !editingWebhookId) {
      return;
    }
    setError("");
    setMessage("");
    setBusyWebhookId(editingWebhookId);
    try {
      await apiWithSession({
        token: auth.token,
        path: `/v1/onboarding/webhooks/${editingWebhookId}`,
        method: "PATCH",
        body: {
          url: editWebhookUrl
        }
      });
      setMessage("Webhook updated.");
      cancelEditWebhook();
      await loadSettings(auth);
    } catch (nextError) {
      setError(nextError.message || "Failed to update webhook");
    } finally {
      setBusyWebhookId("");
    }
  };

  const updateWebhookStatus = async (item, status) => {
    if (!auth) {
      return;
    }
    const isDisable = status === "disabled";
    const confirmed = window.confirm(
      isDisable ? `Disable webhook "${item.url}"?` : `Enable webhook "${item.url}"?`
    );
    if (!confirmed) {
      return;
    }
    setError("");
    setMessage("");
    setBusyWebhookId(item.id);
    try {
      await apiWithSession({
        token: auth.token,
        path: `/v1/onboarding/webhooks/${item.id}`,
        method: "PATCH",
        body: { status }
      });
      setMessage(isDisable ? "Webhook disabled." : "Webhook enabled.");
      if (editingWebhookId === item.id) {
        cancelEditWebhook();
      }
      await loadSettings(auth);
    } catch (nextError) {
      setError(nextError.message || "Failed to update webhook");
    } finally {
      setBusyWebhookId("");
    }
  };

  const deleteWebhookAction = async (item) => {
    if (!auth) {
      return;
    }
    const confirmed = window.confirm(`Delete webhook "${item.url}"? This action cannot be undone.`);
    if (!confirmed) {
      return;
    }
    setError("");
    setMessage("");
    setBusyWebhookId(item.id);
    try {
      await apiWithSession({
        token: auth.token,
        path: `/v1/onboarding/webhooks/${item.id}`,
        method: "DELETE"
      });
      setMessage("Webhook deleted.");
      if (editingWebhookId === item.id) {
        cancelEditWebhook();
      }
      await loadSettings(auth);
    } catch (nextError) {
      setError(nextError.message || "Failed to delete webhook");
    } finally {
      setBusyWebhookId("");
    }
  };

  const saveTreasuryPolicy = async (event) => {
    event.preventDefault();
    if (!auth) {
      return;
    }
    if (!treasuryPreferredNetwork) {
      setError("Choose a preferred treasury network first.");
      return;
    }
    setError("");
    setMessage("");
    setPolicyBusy(true);
    try {
      await apiWithSession({
        token: auth.token,
        path: "/v1/onboarding/policy",
        method: "PATCH",
        body: {
          preferredNetwork: treasuryPreferredNetwork,
          autoBridgeEnabled: treasuryAutoBridgeEnabled
        }
      });
      setMessage("Treasury policy updated.");
      await loadSettings(auth);
    } catch (nextError) {
      setError(nextError.message || "Failed to update treasury policy");
    } finally {
      setPolicyBusy(false);
    }
  };

  const isApiKeysPanel = settingsPanel === "api_keys";
  const isWebhooksPanel = settingsPanel === "webhooks";
  const isTreasuryPanel = settingsPanel === "treasury";
  const allApiKeys = Array.isArray(settings?.apiKeys) ? settings.apiKeys : [];
  const revokedApiKeyCount = allApiKeys.filter((item) => item.status !== "active").length;
  const visibleApiKeys = showRevokedApiKeys
    ? allApiKeys
    : allApiKeys.filter((item) => item.status === "active");

  return (
    <PlatformShell title="Settings" auth={auth} onLogout={logout}>
      {error ? <p className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {message ? <p className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p> : null}
      {lastApiKeyToken ? (
        <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <p>
            Copy API key now: <span className="font-mono">{maskSecretValue(lastApiKeyToken)}</span>
          </p>
          <button
            type="button"
            className="mt-2 rounded border border-amber-400 bg-white px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
            onClick={() => copyText("settings-api-key", lastApiKeyToken)}
          >
            {copiedId === "settings-api-key" ? "Copied" : "Copy API Key"}
          </button>
        </div>
      ) : null}
      {lastSecret ? (
        <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <p>
            Copy webhook signing secret now: <span className="font-mono">{maskSecretValue(lastSecret)}</span>
          </p>
          <button
            type="button"
            className="mt-2 rounded border border-amber-400 bg-white px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
            onClick={() => copyText("settings-webhook-secret", lastSecret)}
          >
            {copiedId === "settings-webhook-secret" ? "Copied" : "Copy Signing Secret"}
          </button>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 md:grid-cols-[220px_1fr]">
        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Settings Sections</p>
          <div className="mt-2 grid gap-1.5">
            <button
              type="button"
              onClick={() => setSettingsPanel("api_keys")}
              className={`rounded-xl border px-3 py-2 text-left text-sm font-medium transition ${
                isApiKeysPanel
                  ? "border-slate-200 bg-white text-rail-800 shadow-sm"
                  : "border-transparent bg-transparent text-slate-700 hover:border-slate-200 hover:bg-white"
              }`}
            >
              API Keys
            </button>
            <button
              type="button"
              onClick={() => setSettingsPanel("webhooks")}
              className={`rounded-xl border px-3 py-2 text-left text-sm font-medium transition ${
                isWebhooksPanel
                  ? "border-slate-200 bg-white text-rail-800 shadow-sm"
                  : "border-transparent bg-transparent text-slate-700 hover:border-slate-200 hover:bg-white"
              }`}
            >
              Webhooks
            </button>
            <button
              type="button"
              onClick={() => setSettingsPanel("treasury")}
              className={`rounded-xl border px-3 py-2 text-left text-sm font-medium transition ${
                isTreasuryPanel
                  ? "border-slate-200 bg-white text-rail-800 shadow-sm"
                  : "border-transparent bg-transparent text-slate-700 hover:border-slate-200 hover:bg-white"
              }`}
            >
              Treasury
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
          {isApiKeysPanel ? (
            <>
              <h3 className="text-base font-semibold">API Keys</h3>
              <form className="mt-2 grid gap-2" onSubmit={createApiKeyAction}>
                <input
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                  placeholder="Key name (optional)"
                  value={apiKeyName}
                  onChange={(event) => setApiKeyName(event.target.value)}
                />
                <button
                  className="rounded-xl border border-rail-700 bg-gradient-to-br from-rail-700 to-rail-800 px-3 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-60"
                  disabled={apiKeyCreateBusy}
                >
                  {apiKeyCreateBusy ? "Creating..." : "Create API key"}
                </button>
              </form>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <p>
                  Active keys are shown by default. Revoked keys stay in the audit trail but are hidden unless you expand them.
                </p>
                {revokedApiKeyCount ? (
                  <button
                    type="button"
                    className="rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-100"
                    onClick={() => setShowRevokedApiKeys((current) => !current)}
                  >
                    {showRevokedApiKeys ? "Hide revoked keys" : `Show revoked keys (${revokedApiKeyCount})`}
                  </button>
                ) : null}
              </div>
              <ul className="mt-2 space-y-2 text-xs text-slate-600">
                {!visibleApiKeys.length ? (
                  <li className="rounded border border-slate-200 bg-white p-2 text-slate-500">
                    No active API keys right now. Create a new key to enable server-to-server access.
                  </li>
                ) : null}
                {visibleApiKeys.map((item) => (
                  <li key={item.id} className="rounded border border-slate-200 bg-white p-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-slate-800">{item.name}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5">{item.role}</span>
                      <span className={`rounded-full px-2 py-0.5 ${item.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
                        {item.status === "active" ? "Active" : "Revoked"}
                      </span>
                      {isCurrentConsoleKey(item) ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">Current console key</span> : null}
                    </div>
                    <p className="mt-1 font-mono">{item.keyPrefix}...</p>

                    {editingKeyId === item.id ? (
                      <form className="mt-2 grid gap-2" onSubmit={saveKeyEdits}>
                        <input
                          className="rounded border border-slate-300 px-2 py-1"
                          value={editKeyName}
                          onChange={(event) => setEditKeyName(event.target.value)}
                          placeholder="Key name"
                          required
                        />
                        <select
                          className="rounded border border-slate-300 px-2 py-1"
                          value={editKeyRole}
                          onChange={(event) => setEditKeyRole(event.target.value)}
                        >
                          <option value="admin">admin</option>
                          <option value="finance">finance</option>
                          <option value="readonly">readonly</option>
                        </select>
                        <div className="flex gap-2">
                          <button
                            className="rounded border border-rail-700 bg-rail-700 px-2 py-1 text-white"
                            disabled={busyKeyId === item.id}
                          >
                            {busyKeyId === item.id ? "Saving..." : "Save"}
                          </button>
                          <button
                            type="button"
                            className="rounded border border-slate-300 px-2 py-1"
                            onClick={cancelEditKey}
                            disabled={busyKeyId === item.id}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100 disabled:opacity-50"
                          onClick={() => startEditKey(item)}
                          disabled={item.status !== "active" || busyKeyId === item.id}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="rounded border border-rose-300 px-2 py-1 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                          onClick={() => revokeApiKeyAction(item)}
                          disabled={item.status !== "active" || busyKeyId === item.id}
                        >
                          {busyKeyId === item.id ? "Revoking..." : "Revoke"}
                        </button>
                        {item.status !== "active" ? (
                          <button
                            type="button"
                            className="rounded border border-rose-300 px-2 py-1 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                            onClick={() => openDeleteRevokedApiKeyModal(item)}
                            disabled={busyKeyId === item.id}
                          >
                            {busyKeyId === item.id ? "Deleting..." : "Delete"}
                          </button>
                        ) : null}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : isWebhooksPanel ? (
            <>
              <h3 className="text-base font-semibold">Webhooks</h3>
              <p className="mt-1 text-xs text-slate-500">
                Enter your backend callback URL (public HTTP/HTTPS). Example:
                <span className="ml-1 font-mono">https://api.yourcompany.com/webhooks/railbridge</span>
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Recommended: keep at least one active webhook so your team receives real-time payment and payout updates.
              </p>
              <form className="mt-2 grid gap-2" onSubmit={addWebhook}>
                <input className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="https://api.yourcompany.com/webhooks/railbridge" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} required />
                <button className="rounded-xl border border-rail-700 bg-gradient-to-br from-rail-700 to-rail-800 px-3 py-2 text-sm font-semibold text-white transition hover:brightness-105">Add webhook</button>
              </form>
              <button
                type="button"
                onClick={testWebhooks}
                className="mt-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-60"
                disabled={webhookTestBusy}
              >
                {webhookTestBusy ? "Sending test..." : "Send test event"}
              </button>
              <ul className="mt-2 space-y-2 text-xs text-slate-600">
                {!(settings?.webhooks || []).length ? (
                  <li className="rounded border border-slate-200 bg-white p-2 text-slate-500">
                    No webhook endpoint yet. Add one to receive real-time events.
                  </li>
                ) : null}
                {(settings?.webhooks || []).map((item) => (
                  <li key={item.id} className="rounded border border-slate-200 bg-white p-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-slate-800">Endpoint</span>
                      <span
                        className={`rounded-full px-2 py-0.5 ${
                          item.status === "active"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-200 text-slate-600"
                        }`}
                      >
                        {item.status === "active" ? "Active" : "Disabled"}
                      </span>
                    </div>
                    {editingWebhookId === item.id ? (
                      <form className="mt-2 grid gap-2" onSubmit={saveWebhookEdits}>
                        <input
                          className="rounded border border-slate-300 px-2 py-1"
                          value={editWebhookUrl}
                          onChange={(event) => setEditWebhookUrl(event.target.value)}
                          placeholder="https://api.yourcompany.com/webhooks/railbridge"
                          required
                        />
                        <div className="flex gap-2">
                          <button
                            className="rounded border border-rail-700 bg-rail-700 px-2 py-1 text-white"
                            disabled={busyWebhookId === item.id}
                          >
                            {busyWebhookId === item.id ? "Saving..." : "Save"}
                          </button>
                          <button
                            type="button"
                            className="rounded border border-slate-300 px-2 py-1"
                            onClick={cancelEditWebhook}
                            disabled={busyWebhookId === item.id}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <p className="mt-1 break-all">{item.url}</p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Last test: {item.lastTestStatus || "Not tested yet"}
                        </p>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100 disabled:opacity-50"
                            onClick={() => startEditWebhook(item)}
                            disabled={busyWebhookId === item.id}
                          >
                            Edit
                          </button>
                          {item.status === "active" ? (
                            <button
                              type="button"
                              className="rounded border border-rose-300 px-2 py-1 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                              onClick={() => updateWebhookStatus(item, "disabled")}
                              disabled={busyWebhookId === item.id}
                            >
                              {busyWebhookId === item.id ? "Updating..." : "Disable"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="rounded border border-emerald-300 px-2 py-1 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                              onClick={() => updateWebhookStatus(item, "active")}
                              disabled={busyWebhookId === item.id}
                            >
                              {busyWebhookId === item.id ? "Updating..." : "Enable"}
                            </button>
                          )}
                          <button
                            type="button"
                            className="rounded border border-rose-300 px-2 py-1 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                            onClick={() => deleteWebhookAction(item)}
                            disabled={busyWebhookId === item.id}
                          >
                            {busyWebhookId === item.id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>

              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-sm font-semibold text-slate-800">Webhook Setup Guide</p>
                <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-slate-600">
                  <li>Create a backend POST endpoint for RailBridge events.</li>
                  <li>Register that endpoint URL above.</li>
                  <li>Copy and store the webhook signing secret shown after creation.</li>
                  <li>Verify signatures using <span className="font-mono">x-railbridge-timestamp</span> and <span className="font-mono">x-railbridge-signature</span>.</li>
                  <li>Return HTTP 200 quickly after successful verification.</li>
                  <li>Use "Send test event" to validate delivery.</li>
                </ol>

                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <p className="text-xs font-medium text-slate-700">Integration code</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={`rounded border px-2 py-1 text-[11px] font-medium ${
                        snippetView === "express"
                          ? "border-rail-700 bg-rail-700 text-white"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                      }`}
                      onClick={() => setSnippetView("express")}
                    >
                      Express
                    </button>
                    <button
                      type="button"
                      className={`rounded border px-2 py-1 text-[11px] font-medium ${
                        snippetView === "next"
                          ? "border-rail-700 bg-rail-700 text-white"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                      }`}
                      onClick={() => setSnippetView("next")}
                    >
                      Next.js Route Handler
                    </button>
                  </div>
                  <SyntaxCodeBlock
                    className="mt-2"
                    language="javascript"
                    code={snippetView === "express" ? EXPRESS_WEBHOOK_SNIPPET : NEXT_WEBHOOK_SNIPPET}
                  />
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                    onClick={() =>
                      copyText(
                        "webhook-snippet",
                        snippetView === "express" ? EXPRESS_WEBHOOK_SNIPPET : NEXT_WEBHOOK_SNIPPET
                      )
                    }
                  >
                    {copiedId === "webhook-snippet" ? "Copied" : "Copy Shown Snippet"}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <h3 className="text-base font-semibold">Treasury Policy</h3>
              <p className="mt-1 text-xs text-slate-500">
                Set the default destination network for cross-chain products when no destination is specified.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Product default is now: accept any supported chain and keep funds on the source chain.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Choose "{SAME_CHAIN_POLICY_LABEL}" if you want cross-chain products without explicit destination to stay on source chain.
              </p>
              <form className="mt-2 grid gap-2" onSubmit={saveTreasuryPolicy}>
                <label className="grid gap-1 text-xs text-slate-600">
                  Preferred treasury network
                  <div className="relative" ref={policyDropdownRef}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-xl border border-slate-300 bg-white px-3 py-2 text-left text-sm"
                      onClick={() => setPolicyDropdownOpen((open) => !open)}
                      disabled={!policyChainOptions.length}
                    >
                      {selectedPolicyOption ? (
                        <span className="inline-flex items-center gap-2">
                          <PolicyNetworkOptionIcon
                            network={selectedPolicyOption.network}
                            displayName={selectedPolicyOption.displayName}
                          />
                          <span>{selectedPolicyOption.displayName}</span>
                        </span>
                      ) : (
                        <span className="text-slate-500">Select network</span>
                      )}
                      <span className="text-slate-500">{policyDropdownOpen ? "▴" : "▾"}</span>
                    </button>
                    {policyDropdownOpen ? (
                      <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-300 bg-white p-1 shadow-xl">
                        {policyChainOptions.map((chain) => {
                          const isSelected = chain.network === treasuryPreferredNetwork;
                          return (
                            <button
                              key={`policy-network-option-${chain.network}`}
                              type="button"
                              className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm ${
                                isSelected
                                  ? "bg-rail-50 text-rail-800"
                                  : "text-slate-700 hover:bg-slate-100"
                              }`}
                              onClick={() => {
                                setTreasuryPreferredNetwork(chain.network);
                                setPolicyDropdownOpen(false);
                              }}
                            >
                              <span className="inline-flex items-center gap-2">
                                <PolicyNetworkOptionIcon
                                  network={chain.network}
                                  displayName={chain.displayName}
                                />
                                <span>{chain.displayName}</span>
                              </span>
                              {isSelected ? <span className="text-xs font-semibold">Selected</span> : null}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </label>
                <label className="mt-1 inline-flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={treasuryAutoBridgeEnabled}
                    onChange={(event) => setTreasuryAutoBridgeEnabled(event.target.checked)}
                  />
                  Auto bridge enabled
                </label>
                <button
                  className="rounded-xl border border-rail-700 bg-gradient-to-br from-rail-700 to-rail-800 px-3 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-60"
                  disabled={policyBusy || !policyChainOptions.length}
                >
                  {policyBusy ? "Saving..." : "Save treasury policy"}
                </button>
              </form>
              {showTestnetsOnly ? (
                <p className="mt-2 text-[11px] text-slate-500">
                  Local demo mode: showing testnets first.
                </p>
              ) : null}
              {!policyChainOptions.length ? (
                <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                  No active chain available. Ensure chain catalog sync is running.
                </p>
              ) : null}
            </>
          )}
        </section>
      </div>

      {pendingRevokedApiKeyDelete ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm sm:p-6 md:p-8">
          <div className="mx-auto flex w-full max-w-[980px] max-h-[92vh] flex-col overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-5 pb-4 pt-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">API Key Management</p>
                  <h4 className="mt-1 text-xl font-semibold text-slate-900">Delete revoked API key</h4>
                </div>
                <button
                  type="button"
                  onClick={closeDeleteRevokedApiKeyModal}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                  disabled={busyKeyId === pendingRevokedApiKeyDelete.id}
                >
                  Close
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-5 pt-4">
              <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                <p className="text-sm font-semibold text-rose-800">This action is permanent</p>
                <p className="mt-1 text-sm text-rose-700">
                  Permanently delete revoked key{" "}
                  <span className="font-semibold text-rose-900">
                    &quot;{pendingRevokedApiKeyDelete.name}&quot;
                  </span>
                  . This removes it from key history and cannot be undone.
                </p>
                <div className="mt-3 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs text-rose-700">
                  Keep revoked keys if you need historical audit visibility for past integrations or incidents.
                </div>
              </section>
            </div>

            <div className="border-t border-slate-200 bg-slate-50 px-5 py-4">
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                  onClick={closeDeleteRevokedApiKeyModal}
                  disabled={busyKeyId === pendingRevokedApiKeyDelete.id}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-rose-300 bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                  onClick={confirmDeleteRevokedApiKey}
                  disabled={busyKeyId === pendingRevokedApiKeyDelete.id}
                >
                  {busyKeyId === pendingRevokedApiKeyDelete.id ? "Deleting..." : "Delete permanently"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

    </PlatformShell>
  );
}
