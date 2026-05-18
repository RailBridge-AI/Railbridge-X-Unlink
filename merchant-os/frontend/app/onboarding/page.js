"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import OnboardingFlowModal from "../../components/console/OnboardingFlowModal";
import PlatformShell from "../../components/console/PlatformShell";
import { apiWithSession } from "../../lib/platformClient";
import { useAuthGuard } from "../../lib/useAuthGuard";

const statusBadge = (status) => {
  if (status === "Completed") {
    return "bg-emerald-100 text-emerald-700";
  }
  if (status === "Current") {
    return "bg-amber-100 text-amber-700";
  }
  if (status === "Upcoming") {
    return "bg-slate-100 text-slate-600";
  }
  return "bg-slate-100 text-slate-600";
};

export default function OnboardingPage() {
  const { auth, logout } = useAuthGuard();
  const [checklist, setChecklist] = useState(null);
  const [error, setError] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardDismissed, setWizardDismissed] = useState(false);
  const steps = checklist?.steps || [];
  const nextPendingIndex = steps.findIndex((step) => !step.completed);
  const hasIncompleteSteps = nextPendingIndex >= 0;

  const loadChecklist = useCallback(async (currentAuth = auth) => {
    if (!currentAuth) {
      return;
    }
    const payload = await apiWithSession({
      token: currentAuth.token,
      path: "/v1/onboarding/checklist"
    });
    setChecklist(payload);
  }, [auth]);

  const resolveStepStatus = (stepId) => {
    const stepIndex = steps.findIndex((step) => step.id === stepId);
    if (stepIndex < 0) {
      return "Pending";
    }
    const step = steps[stepIndex];
    if (step.completed) {
      return "Completed";
    }
    if (nextPendingIndex >= 0 && stepIndex === nextPendingIndex) {
      return "Current";
    }
    if (nextPendingIndex >= 0 && stepIndex > nextPendingIndex) {
      return "Upcoming";
    }
    return "Pending";
  };

  const merchantId = auth?.merchantId || "<MERCHANT_ID>";

  useEffect(() => {
    if (!auth) {
      return;
    }
    loadChecklist(auth).catch((nextError) => {
      setError(nextError.message || "Failed to load onboarding checklist");
    });
  }, [auth, loadChecklist]);

  useEffect(() => {
    if (!steps.length) {
      return;
    }
    if (!hasIncompleteSteps) {
      setWizardOpen(false);
      setWizardDismissed(false);
      return;
    }
    if (!wizardDismissed) {
      setWizardOpen(true);
    }
  }, [steps, hasIncompleteSteps, wizardDismissed]);

  return (
    <PlatformShell title="Onboarding Wizard" auth={auth} onLogout={logout}>
      <OnboardingFlowModal
        open={wizardOpen}
        checklist={checklist}
        auth={auth}
        onClose={() => {
          setWizardOpen(false);
          setWizardDismissed(true);
        }}
        onRefresh={async () => {
          setError("");
          try {
            await loadChecklist();
          } catch (nextError) {
            setError(nextError.message || "Failed to refresh checklist");
            throw nextError;
          }
        }}
      />

      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-rail-700 via-cyan-700 to-rail-600 p-5 text-white">
        <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(-38deg,rgba(255,255,255,0.08)_0,rgba(255,255,255,0.08)_2px,transparent_2px,transparent_32px)]"></div>
        <div className="relative z-10">
          <p className="text-xs uppercase tracking-[0.14em] text-cyan-100">Go Live Checklist</p>
          <h3 className="mt-2 text-2xl font-semibold tracking-tight">From signup to first USDC payout</h3>
          <p className="mt-2 max-w-3xl text-sm text-cyan-100/95">
            Complete these steps to finish integration: issue API credentials, register webhooks, create products,
            run a sandbox payment, then validate payout.
          </p>
        </div>
      </section>

      {error ? <p className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold">Guided Integration</h3>
          <div className="flex items-center gap-2">
            {hasIncompleteSteps ? (
              <button
                type="button"
                onClick={() => {
                  setWizardDismissed(false);
                  setWizardOpen(true);
                }}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                Resume Guided Onboarding
              </button>
            ) : null}
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">Merchant ID: {merchantId}</span>
          </div>
        </div>
        <p className="mt-1 text-xs text-slate-500">Use this as a reference while the guided modal walks one step at a time.</p>

        <div className="mt-3 grid gap-3">
          <article className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold">1. Create API key</h4>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusBadge(resolveStepStatus("api_key"))}`}>
                {resolveStepStatus("api_key")}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">Go to Settings and create your first API key for server-to-server access.</p>
            <Link className="mt-2 inline-flex rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs hover:bg-slate-100" href="/settings">
              Open Settings
            </Link>
          </article>

          <article className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold">2. Verify webhook signatures in merchant backend</h4>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusBadge(resolveStepStatus("webhook"))}`}>
                {resolveStepStatus("webhook")}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Register a backend callback URL (for example `https://api.yourcompany.com/webhooks/railbridge`) and reject unsigned or invalid requests before processing events.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Use the Webhook Setup Guide in Settings for step-by-step implementation.
            </p>
            <Link className="mt-2 inline-flex rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs hover:bg-slate-100" href="/settings">
              Open Webhook Guide
            </Link>
          </article>

          <article className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold">3. Create first paid route/product</h4>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusBadge(resolveStepStatus("product"))}`}>
                {resolveStepStatus("product")}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Define method, path, and USDC price. RailBridge defaults to accepting from any supported network and auto-settlement.
            </p>
            <Link className="mt-2 inline-flex rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs hover:bg-slate-100" href="/products">
              Open Products
            </Link>
          </article>

          <article className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold">4. Accept first sandbox payment</h4>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusBadge(resolveStepStatus("sandbox_payment"))}`}>
                {resolveStepStatus("sandbox_payment")}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Your backend requests payment instructions for the paid route. RailBridge returns payment options, then
              handles verification and settlement after the customer pays.
            </p>
            <Link className="mt-2 inline-flex rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs hover:bg-slate-100" href="/settlements">
              Open Settlements
            </Link>
          </article>

          <article className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold">5. Validate payout flow</h4>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusBadge(resolveStepStatus("payout_test"))}`}>
                {resolveStepStatus("payout_test")}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">After first settlement, run a small payout to validate treasury operations end-to-end.</p>
            <Link className="mt-2 inline-flex rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs hover:bg-slate-100" href="/payouts">
              Open Payouts
            </Link>
          </article>
        </div>

      </section>
    </PlatformShell>
  );
}
