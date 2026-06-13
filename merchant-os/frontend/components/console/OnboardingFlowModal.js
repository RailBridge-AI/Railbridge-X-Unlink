"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { apiWithMerchantKey, apiWithSession } from "../../lib/platformClient";
import SyntaxCodeBlock from "./SyntaxCodeBlock";
import {
  BACKEND_REQUIREMENTS_CURL,
  BACKEND_REQUIREMENTS_SNIPPET
} from "../../lib/integrationSnippets";

const STEP_META = {
  api_key: {
    title: "Create API key",
    description: "Generate an API key your backend will use to call RailBridge APIs.",
    actionLabel: "Create API Key Now",
    kind: "create_api_key"
  },
  webhook: {
    title: "Register webhook endpoint",
    description: "Add your webhook URL so RailBridge can push payment and payout lifecycle events.",
    actionLabel: "Register Webhook",
    kind: "register_webhook"
  },
  product: {
    title: "Create first paid product",
    description: "Define the endpoint, method, and USDC price customers pay to access it.",
    actionLabel: "Open Products",
    kind: "navigate",
    href: "/products"
  },
  sandbox_payment: {
    title: "Receive first sandbox payment",
    description:
      "Your backend makes one request for payment instructions; RailBridge handles validation, settlement, and fund movement after the customer pays.",
    actionLabel: "Open Activity",
    kind: "navigate",
    href: "/settlements"
  },
  payout_test: {
    title: "Run payout test",
    description: "Submit a small payout to confirm end-to-end treasury operations.",
    actionLabel: "Open Payouts",
    kind: "navigate",
    href: "/payouts"
  }
};

const WEBHOOK_SKIPPED_MESSAGE =
  "Webhook step skipped for now. Continue setup and configure webhook later in Settings.";
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

const classNames = (...values) => values.filter(Boolean).join(" ");

export default function OnboardingFlowModal({
  open,
  checklist,
  auth,
  onClose,
  onRefresh
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [createdApiKey, setCreatedApiKey] = useState("");
  const [apiKeyCopied, setApiKeyCopied] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const [showWebhookSkipWarning, setShowWebhookSkipWarning] = useState(false);
  const [closeAttemptedWhileWebhookIncomplete, setCloseAttemptedWhileWebhookIncomplete] = useState(false);
  const [skippedStepIds, setSkippedStepIds] = useState([]);
  const [integrationBusy, setIntegrationBusy] = useState(false);
  const [mounted, setMounted] = useState(false);

  const summary = useMemo(() => {
    const steps = checklist?.steps || [];
    const completed = steps.filter((step) => step.completed).length;
    const progressed = steps.filter(
      (step) => step.completed || skippedStepIds.includes(step.id)
    ).length;
    const currentIndex = steps.findIndex(
      (step) => !step.completed && !skippedStepIds.includes(step.id)
    );
    const defaultActiveIndex = currentIndex >= 0 ? currentIndex : Math.max(0, steps.length - 1);
    const lockOnApiKeyStep = Boolean(createdApiKey);
    const activeIndex = lockOnApiKeyStep ? 0 : defaultActiveIndex;
    const activeStep = lockOnApiKeyStep
      ? { id: "api_key", label: "Create API key", completed: false }
      : currentIndex >= 0
        ? steps[activeIndex] || null
        : null;
    const total = steps.length || 1;
    return {
      steps,
      completed,
      progressed,
      total,
      activeIndex,
      activeStep,
      isComplete: steps.length > 0 && completed === steps.length,
      isCompleteForWizard:
        steps.length > 0 &&
        steps.every((step) => step.completed || skippedStepIds.includes(step.id)) &&
        !lockOnApiKeyStep,
      percent: Math.round((progressed / total) * 100),
      lockOnApiKeyStep,
      skippedStepIds
    };
  }, [checklist, createdApiKey, skippedStepIds]);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (summary.activeStep?.id !== "webhook" && message === WEBHOOK_SKIPPED_MESSAGE) {
      setMessage("");
    }
  }, [message, summary.activeStep?.id]);

  useEffect(() => {
    if (!createdApiKey) {
      return;
    }
    const timer = setTimeout(() => {
      setCreatedApiKey("");
      setApiKeyCopied(false);
    }, 5 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [createdApiKey]);

  useEffect(() => {
    if (!webhookSecret) {
      return;
    }
    const timer = setTimeout(() => setWebhookSecret(""), 5 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [webhookSecret]);

  if (!mounted || !open || !auth || (!summary.activeStep && !summary.isCompleteForWizard)) {
    return null;
  }

  const activeMeta = summary.activeStep
    ? STEP_META[summary.activeStep.id] || {
      title: summary.activeStep.label,
      description: "Complete this step to continue onboarding.",
      actionLabel: "Continue",
      kind: "refresh"
    }
    : null;
  const webhookStepIncomplete =
    summary.activeStep?.id === "webhook" && !summary.activeStep?.completed;

  const withRefresh = async () => {
    if (typeof onRefresh === "function") {
      await onRefresh();
    }
  };

  const runPrimaryAction = async () => {
    setError("");
    setMessage("");
    setCreatedApiKey("");
    setWebhookSecret("");

    if (activeMeta.kind === "navigate") {
      router.push(activeMeta.href || "/onboarding");
      onClose?.();
      return;
    }

    if (activeMeta.kind === "refresh") {
      await withRefresh();
      return;
    }

    if (busy) {
      return;
    }

    setBusy(true);
    try {
      if (activeMeta.kind === "create_api_key") {
        const payload = await apiWithSession({
          token: auth.token,
          path: "/v1/onboarding/api-keys",
          method: "POST",
          body: {
            name: `Guided API Key ${new Date().toISOString()}`
          }
        });
        setCreatedApiKey(payload.token || "");
        setApiKeyCopied(false);
        setMessage("API key created. Save it now, then continue.");
      } else if (activeMeta.kind === "register_webhook") {
        const trimmed = String(webhookUrl || "").trim();
        if (!/^https?:\/\//.test(trimmed)) {
          throw new Error("Enter a valid http(s) webhook URL.");
        }
        const signingSecret = generateWebhookSigningSecret();
        await apiWithSession({
          token: auth.token,
          path: "/v1/onboarding/webhooks",
          method: "POST",
          body: {
            url: trimmed,
            signingSecret
          }
        });
        setWebhookSecret(signingSecret);
        setMessage("Webhook registered. Save the signing secret now.");
        setWebhookUrl("");
        await withRefresh();
      }
    } catch (nextError) {
      setError(nextError.message || "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const confirmApiKeyAndContinue = async () => {
    if (!createdApiKey || !apiKeyCopied || busy) {
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await withRefresh();
      setCreatedApiKey("");
      setApiKeyCopied(false);
      setCopiedId("");
      setMessage("API key confirmed. Proceeding to the next step.");
    } catch (nextError) {
      setError(nextError.message || "Failed to confirm API key step");
    } finally {
      setBusy(false);
    }
  };

  const refreshOnly = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await withRefresh();
      setMessage("Checklist refreshed.");
    } catch (nextError) {
      setError(nextError.message || "Refresh failed");
    } finally {
      setBusy(false);
    }
  };

  const copyText = async (id, value) => {
    try {
      await navigator.clipboard.writeText(String(value || ""));
      setCopiedId(id);
      if (id === "new-api-key") {
        setApiKeyCopied(true);
      }
      window.setTimeout(() => setCopiedId(""), 1200);
    } catch {
      setError("Clipboard copy failed. Copy manually from the value.");
    }
  };

  const runIntegrationCheck = async () => {
    if (!auth || integrationBusy) {
      return;
    }

    setIntegrationBusy(true);
    setError("");
    setMessage("");
    try {
      const products = await apiWithMerchantKey({
        apiKey: auth.apiKey,
        path: `/v1/merchants/${auth.merchantId}/products`
      });
      const activeProduct = Array.isArray(products.items)
        ? products.items.find((item) => Boolean(item?.enabled))
        : null;

      if (!activeProduct) {
        throw new Error("Create a paid product first, then run integration check.");
      }

      const resolved = await apiWithMerchantKey({
        apiKey: auth.apiKey,
        path: "/v1/sdk/requirements/resolve",
        method: "POST",
        body: {
          apiId: activeProduct.apiId,
          method: activeProduct.method,
          path: activeProduct.path
        }
      });

      const optionCount = Array.isArray(resolved.requirements)
        ? resolved.requirements.length
        : resolved.requirement
          ? 1
          : 0;

      setMessage(
        `Integration check passed. RailBridge resolved ${optionCount} payment option(s) for ${activeProduct.method} ${activeProduct.path}.`
      );
    } catch (nextError) {
      setError(nextError.message || "Integration check failed");
    } finally {
      setIntegrationBusy(false);
    }
  };

  const requestClose = () => {
    if (webhookStepIncomplete) {
      setCloseAttemptedWhileWebhookIncomplete(true);
      setShowWebhookSkipWarning(true);
      return;
    }
    onClose?.();
  };

  const confirmSkipWebhook = () => {
    setShowWebhookSkipWarning(false);
    setCloseAttemptedWhileWebhookIncomplete(false);
    setSkippedStepIds((current) =>
      current.includes("webhook") ? current : [...current, "webhook"]
    );
    setMessage("");
  };

  const modalContent = (
    <div className="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm sm:p-6 md:p-8">
      <div className="mx-auto flex w-full max-w-[1240px] max-h-[92vh] flex-col overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-200 px-5 pb-4 pt-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Guided Onboarding</p>
              <h3 className="mt-1 text-xl font-semibold text-slate-900">Set up RailBridge step by step</h3>
            </div>
            <button
              type="button"
              onClick={requestClose}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              Close
            </button>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full bg-gradient-to-r from-rail-600 to-cyan-600 transition-all"
              style={{ width: `${summary.percent}%` }}
            ></div>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Progress: {summary.progressed}/{summary.total} done in wizard
          </p>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-5 pt-4">
          {showWebhookSkipWarning ? (
            <section className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber-400 bg-amber-100 text-[11px] font-bold text-amber-800">
                  !
                </span>
                <div>
                  <p className="font-semibold">Skip webhook setup?</p>
                  <p className="mt-1 text-xs text-amber-800">
                    You can continue without webhook, but your backend will not receive real-time payment and payout
                    events. You will need to poll APIs manually and can miss async updates.
                  </p>
                  {closeAttemptedWhileWebhookIncomplete ? (
                    <p className="mt-1 text-xs font-semibold text-amber-900">
                      To close onboarding now, press <span className="font-mono">"Skip For Now"</span> first.
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowWebhookSkipWarning(false);
                    setCloseAttemptedWhileWebhookIncomplete(false);
                  }}
                  className="rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
                >
                  Continue Webhook Setup
                </button>
                <button
                  type="button"
                  onClick={confirmSkipWebhook}
                  className="rounded-lg border border-amber-700 bg-amber-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:brightness-105"
                >
                  Skip For Now
                </button>
              </div>
            </section>
          ) : null}

          {summary.isCompleteForWizard ? (
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-semibold text-emerald-800">All onboarding steps are complete.</p>
              <p className="mt-1 text-sm text-emerald-700">Your merchant workspace is ready to operate.</p>
              {summary.skippedStepIds.includes("webhook") ? (
                <p className="mt-1 text-xs text-amber-800">
                  Note: Webhook was skipped. Set it up in Settings before production go-live.
                </p>
              ) : null}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onClose?.();
                    router.push("/overview");
                  }}
                  className="rounded-xl border border-emerald-700 bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:brightness-105"
                >
                  Go To Overview
                </button>
              </div>
            </section>
          ) : (
            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 bg-white text-xs font-semibold text-slate-700">
                  {summary.activeIndex + 1}
                </span>
                <p className="text-base font-semibold text-slate-900">{activeMeta.title}</p>
              </div>
              <p className="text-sm text-slate-600">{activeMeta.description}</p>

              {summary.activeStep.id === "webhook" ? (
                <div className="mt-3 space-y-2">
                  <label className="block text-xs font-medium text-slate-600">
                    Webhook URL
                    <input
                      className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                      placeholder="https://api.yourcompany.com/webhooks/railbridge"
                      value={webhookUrl}
                      onChange={(event) => setWebhookUrl(event.target.value)}
                    />
                  </label>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600">
                    <p className="font-medium text-slate-700">What URL should go here?</p>
                    <p className="mt-1">
                      Use your backend callback endpoint that accepts POST requests, for example:
                      <span className="ml-1 font-mono">https://api.yourcompany.com/webhooks/railbridge</span>
                    </p>
                    <p className="mt-1">
                      This URL must be hosted by your backend service. Do not use a frontend page URL.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onClose?.();
                      router.push("/settings?panel=webhooks");
                    }}
                    className="inline-flex rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    More Details In Settings
                  </button>
                </div>
              ) : null}
              {summary.activeStep.id === "sandbox_payment" ? (
                <div className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-xs font-semibold text-slate-700">Backend integration snippet</p>
                  <p className="text-[11px] text-slate-500">
                    Start with the SDK-first snippet. The curl example is only for low-level connectivity checks.
                  </p>
                  <SyntaxCodeBlock language="javascript" code={BACKEND_REQUIREMENTS_SNIPPET} />
                  <SyntaxCodeBlock language="bash" code={BACKEND_REQUIREMENTS_CURL} />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => copyText("modal-backend-snippet", BACKEND_REQUIREMENTS_SNIPPET)}
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    >
                      {copiedId === "modal-backend-snippet" ? "Copied" : "Copy backend snippet"}
                    </button>
                    <button
                      type="button"
                      onClick={() => copyText("modal-backend-curl", BACKEND_REQUIREMENTS_CURL)}
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    >
                      {copiedId === "modal-backend-curl" ? "Copied" : "Copy curl test"}
                    </button>
                    <button
                      type="button"
                      onClick={runIntegrationCheck}
                      disabled={integrationBusy}
                      className="rounded-lg border border-rail-700 bg-gradient-to-br from-rail-700 to-rail-800 px-2.5 py-1.5 text-xs font-semibold text-white hover:brightness-105 disabled:opacity-60"
                    >
                      {integrationBusy ? "Checking..." : "Run integration check"}
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={runPrimaryAction}
                  disabled={busy}
                  className={classNames(
                    "rounded-xl border border-rail-700 bg-gradient-to-br from-rail-700 to-rail-800 px-3 py-2 text-sm font-semibold text-white transition hover:brightness-105",
                    busy ? "opacity-60" : ""
                  )}
                >
                  {busy ? "Working..." : activeMeta.actionLabel}
                </button>
                {summary.lockOnApiKeyStep ? (
                  <button
                    type="button"
                    onClick={confirmApiKeyAndContinue}
                    disabled={busy || !apiKeyCopied}
                    className="rounded-xl border border-emerald-700 bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-60"
                  >
                    {busy ? "Working..." : "I Have Copied It, Continue"}
                  </button>
                ) : null}
                {webhookStepIncomplete ? (
                  <button
                    type="button"
                    onClick={() => setShowWebhookSkipWarning(true)}
                    className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100"
                  >
                    Skip Webhook For Now
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={refreshOnly}
                  disabled={busy}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                >
                  Refresh Status
                </button>
              </div>
            </section>
          )}

          {createdApiKey ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <p>
                Copy API key now: <span className="font-mono">{maskSecretValue(createdApiKey)}</span>
              </p>
              <button
                type="button"
                className="mt-2 rounded border border-amber-400 bg-white px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
                onClick={() => copyText("new-api-key", createdApiKey)}
              >
                {copiedId === "new-api-key" ? "Copied" : "Copy API Key"}
              </button>
              {apiKeyCopied ? (
                <p className="mt-2 text-[11px] font-medium text-emerald-700">
                  API key copied. Click "I Have Copied It, Continue" to unlock Step 2.
                </p>
              ) : (
                <p className="mt-2 text-[11px] text-amber-800">
                  Step 2 stays locked until you copy this key and confirm.
                </p>
              )}
            </div>
          ) : null}
          {webhookSecret ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <p>
                Copy webhook signing secret now: <span className="font-mono">{maskSecretValue(webhookSecret)}</span>
              </p>
              <button
                type="button"
                className="mt-2 rounded border border-amber-400 bg-white px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
                onClick={() => copyText("webhook-secret", webhookSecret)}
              >
                {copiedId === "webhook-secret" ? "Copied" : "Copy Signing Secret"}
              </button>
            </div>
          ) : null}
          {message ? (
            <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>
          ) : null}
          {error ? (
            <p className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
          ) : null}

        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
