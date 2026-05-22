"use client";

import Link from "next/link";
import { formatUsdcBaseUnits, getNetworkInfo } from "../../lib/assetDisplay";
import { buildExplorerTransactionUrl } from "../../lib/explorerLinks";

export const BRIDGE_PREFLIGHT_STEPS = [
  {
    id: "usdc",
    title: "Verify USDC balance",
    detail: "Confirm spendable balance on the source network"
  },
  {
    id: "gas",
    title: "Check native gas",
    detail: "Read ETH balances on source and destination wallets"
  },
  {
    id: "estimate",
    title: "Estimate bridge gas",
    detail: "Circle Bridge Kit fee and gas requirements"
  },
  {
    id: "topup",
    title: "Gas sponsor top-up",
    detail: "Send ETH top-up transactions if wallets are short on gas"
  },
  {
    id: "queue",
    title: "Queue transfer",
    detail: "Create transfer record and start the background bridge"
  }
];

export const BRIDGE_BACKGROUND_STEPS = [
  {
    id: "queued",
    title: "Transfer queued",
    detail: "Preflight passed; bridge job is running server-side"
  },
  {
    id: "bridging",
    title: "Circle bridge in progress",
    detail: "Burn USDC on source chain, then mint on destination (often several minutes)"
  },
  {
    id: "settle",
    title: "Update balances",
    detail: "Refresh treasury balances after confirmation"
  }
];

const StepIcon = ({ state }) => {
  if (state === "done") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
        ✓
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-rail-600 border-t-transparent animate-spin" />
    );
  }
  if (state === "error") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700">
        !
      </span>
    );
  }
  return <span className="mt-0.5 h-6 w-6 shrink-0 rounded-full border-2 border-slate-200 bg-white" />;
};

const StepList = ({ steps, activeIndex, terminalIndex = -1, errorIndex = -1 }) => (
  <ol className="grid gap-2">
    {steps.map((step, index) => {
      let state = "pending";
      if (errorIndex >= 0 && index === errorIndex) {
        state = "error";
      } else if (index < activeIndex || (terminalIndex >= 0 && index <= terminalIndex)) {
        state = "done";
      } else if (index === activeIndex) {
        state = "active";
      }
      return (
        <li key={step.id} className="flex gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
          <StepIcon state={state} />
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900">{step.title}</p>
            {step.detail ? <p className="mt-0.5 text-xs text-slate-500">{step.detail}</p> : null}
          </div>
        </li>
      );
    })}
  </ol>
);

const consolidationStatusLabel = (status) => {
  switch (String(status || "").trim()) {
    case "submitted":
      return "Bridging";
    case "confirmed":
      return "Complete";
    case "failed":
      return "Failed";
    case "requested":
      return "Queued";
    default:
      return status || "Unknown";
  }
};

const buildConsolidationTxLinks = (consolidation, chainsByNetwork) => {
  const links = [];
  const seen = new Set();
  const push = ({ label, txHash, network }) => {
    const hash = String(txHash || "").trim();
    const net = String(network || "").trim();
    if (!hash) {
      return;
    }
    const key = `${hash.toLowerCase()}::${net}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    const explorerUrl = buildExplorerTransactionUrl(chainsByNetwork[net]?.explorerUrl, hash);
    links.push({ label, txHash: hash, network: net, explorerUrl });
  };

  const sourceTxHash = String(consolidation?.sourceTxHash || "").trim();
  const bridgeTxHash = String(consolidation?.bridgeTxHash || "").trim();
  if (sourceTxHash && bridgeTxHash && sourceTxHash.toLowerCase() === bridgeTxHash.toLowerCase()) {
    push({ label: "Bridge transaction", txHash: bridgeTxHash, network: consolidation.sourceNetwork });
  } else {
    push({ label: "Source burn", txHash: sourceTxHash, network: consolidation.sourceNetwork });
    push({ label: "Bridge transaction", txHash: bridgeTxHash, network: consolidation.sourceNetwork });
  }
  push({
    label: "Destination mint",
    txHash: consolidation?.destinationTxHash,
    network: consolidation.destinationNetwork
  });
  return links;
};

export default function BridgeTransferProgress({
  phase,
  preflightStepIndex = 0,
  backgroundStepIndex = 0,
  gasTopUpLikely = false,
  consolidation = null,
  errorMessage = "",
  chainsByNetwork = {},
  onDismiss
}) {
  if (!phase || phase === "idle") {
    return null;
  }

  const sourceInfo = getNetworkInfo(consolidation?.sourceNetwork);
  const destinationInfo = getNetworkInfo(consolidation?.destinationNetwork);
  const amountLabel = consolidation?.amount ? formatUsdcBaseUnits(consolidation.amount) : null;
  const txLinks = consolidation ? buildConsolidationTxLinks(consolidation, chainsByNetwork) : [];
  const status = String(consolidation?.status || "").trim();
  const isTerminal = phase === "confirmed" || phase === "failed";
  const preflightActiveIndex =
    phase === "preflight" ? Math.min(preflightStepIndex, BRIDGE_PREFLIGHT_STEPS.length - 1) : BRIDGE_PREFLIGHT_STEPS.length;
  const preflightDoneThrough =
    phase === "preflight" ? Math.max(0, preflightActiveIndex - 1) : BRIDGE_PREFLIGHT_STEPS.length - 1;

  const backgroundActiveIndex =
    phase === "bridging" || phase === "refreshing"
      ? Math.min(backgroundStepIndex, BRIDGE_BACKGROUND_STEPS.length - 1)
      : phase === "confirmed" || phase === "failed"
        ? BRIDGE_BACKGROUND_STEPS.length
        : 0;

  const headline =
    phase === "preflight"
      ? "Running preflight checks"
      : phase === "refreshing"
        ? "Transfer complete — refreshing balances"
        : phase === "confirmed"
          ? "Transfer complete"
          : phase === "failed"
            ? "Transfer failed"
            : "Bridge running in background";

  const subhead =
    phase === "preflight"
      ? gasTopUpLikely
        ? "This can take a few minutes if gas sponsor top-ups are sent."
        : "Verifying balances and gas before the on-chain bridge starts."
      : phase === "bridging" || phase === "refreshing"
        ? "The submit button only waits for preflight. The Circle transfer continues here."
        : null;

  return (
    <div
      className={`mt-3 rounded-2xl border p-3 ${
        phase === "failed"
          ? "border-rose-200 bg-rose-50"
          : phase === "confirmed"
            ? "border-emerald-200 bg-emerald-50"
            : "border-slate-200 bg-white"
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">{headline}</p>
          {subhead ? <p className="mt-1 text-xs text-slate-600">{subhead}</p> : null}
        </div>
        {consolidation?.id ? (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
            {consolidationStatusLabel(status)}
          </span>
        ) : null}
      </div>

      {consolidation?.id && amountLabel ? (
        <p className="mt-2 text-xs text-slate-600">
          {amountLabel} USDC · {sourceInfo.name} → {destinationInfo.name}
          <span className="ml-2 font-mono text-[10px] text-slate-500">{consolidation.id}</span>
          {" · "}
          <Link href="/settlements" className="font-medium text-rail-800 underline-offset-2 hover:underline">
            View in Activity
          </Link>
        </p>
      ) : null}

      {phase === "preflight" ||
      phase === "bridging" ||
      phase === "refreshing" ||
      phase === "confirmed" ||
      (phase === "failed" && preflightActiveIndex > 0) ? (
        <div className="mt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Preflight</p>
          <StepList
            steps={BRIDGE_PREFLIGHT_STEPS}
            activeIndex={preflightActiveIndex}
            terminalIndex={phase !== "preflight" ? BRIDGE_PREFLIGHT_STEPS.length - 1 : preflightDoneThrough}
            errorIndex={phase === "failed" && preflightActiveIndex === 0 ? 0 : -1}
          />
        </div>
      ) : null}

      {phase === "bridging" || phase === "refreshing" || phase === "confirmed" || (phase === "failed" && consolidation?.id) ? (
        <div className="mt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">On-chain bridge</p>
          <StepList
            steps={BRIDGE_BACKGROUND_STEPS}
            activeIndex={backgroundActiveIndex}
            terminalIndex={
              phase === "confirmed" ? BRIDGE_BACKGROUND_STEPS.length - 1 : phase === "failed" ? 1 : -1
            }
            errorIndex={phase === "failed" ? Math.max(1, backgroundActiveIndex) : -1}
          />
        </div>
      ) : null}

      {errorMessage ? (
        <p className="mt-3 rounded-xl border border-rose-300 bg-white px-3 py-2 text-sm text-rose-700">
          {errorMessage}
        </p>
      ) : null}

      {consolidation?.failReason && phase === "failed" ? (
        <p className="mt-2 text-xs text-rose-800">{consolidation.failReason}</p>
      ) : null}

      {txLinks.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {txLinks.map((link) => (
            link.explorerUrl ? (
              <a
                key={`${link.label}-${link.txHash}`}
                href={link.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-rail-800 hover:bg-slate-100"
              >
                {link.label}
              </a>
            ) : (
              <span
                key={`${link.label}-${link.txHash}`}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-[10px] text-slate-600"
                title={link.txHash}
              >
                {link.label}: {link.txHash.slice(0, 10)}…
              </span>
            )
          ))}
        </div>
      ) : null}

      {isTerminal && onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="mt-3 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Dismiss
        </button>
      ) : null}
    </div>
  );
}
