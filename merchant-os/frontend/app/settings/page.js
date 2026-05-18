"use client";

import { useEffect, useState } from "react";
import PlatformShell from "../../components/console/PlatformShell";
import { apiWithSession } from "../../lib/platformClient";
import { useAuthGuard } from "../../lib/useAuthGuard";

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
  const currentConsolePrefix = auth?.apiKey ? String(auth.apiKey).slice(0, 16) : "";

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
      const payload = await apiWithSession({
        token: auth.token,
        path: "/v1/onboarding/webhooks",
        method: "POST",
        body: { url: webhookUrl }
      });
      setLastSecret(payload.signingSecret || "");
      setWebhookUrl("");
      setMessage("Webhook endpoint created.");
      await loadSettings(auth);
    } catch (nextError) {
      setError(nextError.message || "Failed to create webhook");
    }
  };

  const createApiKeyAction = async (event) => {
    event.preventDefault();
    if (!auth) {
      return;
    }
    setError("");
    setMessage("");
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
    const isCurrentConsoleKey = item.keyPrefix === currentConsolePrefix;
    const confirmed = window.confirm(
      isCurrentConsoleKey
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
      await loadSettings(auth);
      if (isCurrentConsoleKey) {
        setMessage("Current console key revoked. Redirecting to login to refresh credentials.");
        window.setTimeout(() => logout(), 900);
      }
    } catch (nextError) {
      setError(nextError.message || "Failed to revoke API key");
    } finally {
      setBusyKeyId("");
    }
  };

  const testWebhooks = async () => {
    if (!auth) {
      return;
    }
    setError("");
    setMessage("");
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

  const isApiKeysPanel = settingsPanel === "api_keys";
  const isWebhooksPanel = settingsPanel === "webhooks";

  return (
    <PlatformShell title="Settings" auth={auth} onLogout={logout}>
      {error ? <p className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {message ? <p className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p> : null}
      {lastApiKeyToken ? (
        <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <p>
            Copy API key now: <span className="font-mono">{lastApiKeyToken}</span>
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
            Copy webhook signing secret now: <span className="font-mono">{lastSecret}</span>
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
                <button className="rounded-xl border border-rail-700 bg-gradient-to-br from-rail-700 to-rail-800 px-3 py-2 text-sm font-semibold text-white transition hover:brightness-105">
                  Create API key
                </button>
              </form>
              <ul className="mt-2 space-y-2 text-xs text-slate-600">
                {(settings?.apiKeys || []).map((item) => (
                  <li key={item.id} className="rounded border border-slate-200 bg-white p-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-slate-800">{item.name}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5">{item.role}</span>
                      <span className={`rounded-full px-2 py-0.5 ${item.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
                        {item.status === "active" ? "Active" : "Revoked"}
                      </span>
                      {item.keyPrefix === currentConsolePrefix ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">Current console key</span> : null}
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
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : (
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
              <button type="button" onClick={testWebhooks} className="mt-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-100">
                Send test event
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
                  <pre className="mt-2 overflow-x-auto rounded border border-slate-200 bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
                    <code>{snippetView === "express" ? EXPRESS_WEBHOOK_SNIPPET : NEXT_WEBHOOK_SNIPPET}</code>
                  </pre>
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
          )}
        </section>
      </div>

    </PlatformShell>
  );
}
