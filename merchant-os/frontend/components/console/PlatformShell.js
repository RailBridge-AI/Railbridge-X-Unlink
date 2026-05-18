"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_SECTIONS = [
  {
    label: "Launch",
    items: [
      { href: "/onboarding", label: "Onboarding", icon: "rocket" },
      { href: "/overview", label: "Overview", icon: "pulse" }
    ]
  },
  {
    label: "Operations",
    items: [
      { href: "/settlements", label: "Settlements", icon: "history" },
      { href: "/products", label: "Products", icon: "box" },
      { href: "/payouts", label: "Payouts", icon: "cash" }
    ]
  },
  {
    label: "Admin",
    items: [{ href: "/settings", label: "Settings", icon: "gear" }]
  }
];

const classNames = (...values) => values.filter(Boolean).join(" ");

function NavIcon({ kind, active }) {
  const iconClass = classNames(
    "h-3.5 w-3.5",
    active ? "text-rail-700" : "text-slate-500"
  );

  if (kind === "rocket") {
    return (
      <svg className={iconClass} viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M9 11L5 15M11 9L15 5M13 13C9 13 7 11 7 7C7 5 8 3 10 2C12 3 13 5 13 7C13 11 11 13 7 13C5 13 3 12 2 10C3 8 5 7 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (kind === "pulse") {
    return (
      <svg className={iconClass} viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M2.5 10H6L8 6L11 14L13 10H17.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (kind === "history") {
    return (
      <svg className={iconClass} viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M10 4V1.8M10 10H14M4.2 6.2L2.5 4.5M15.8 6.2L17.5 4.5M10 18.2A8.2 8.2 0 1 1 18.2 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (kind === "box") {
    return (
      <svg className={iconClass} viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M3 6.5L10 3L17 6.5L10 10L3 6.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M3 6.5V13.5L10 17L17 13.5V6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (kind === "cash") {
    return (
      <svg className={iconClass} viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="2.5" y="5" width="15" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="10" cy="10" r="2.3" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    );
  }

  if (kind === "gear") {
    return (
      <svg className={iconClass} viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M10 3.5L11.2 4.1L12.6 3.9L13.4 5L14.8 5.3L14.9 6.7L16 7.6L15.5 8.9L16 10.2L14.9 11.1L14.8 12.5L13.4 12.8L12.6 13.9L11.2 13.7L10 14.3L8.8 13.7L7.4 13.9L6.6 12.8L5.2 12.5L5.1 11.1L4 10.2L4.5 8.9L4 7.6L5.1 6.7L5.2 5.3L6.6 5L7.4 3.9L8.8 4.1L10 3.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <circle cx="10" cy="8.9" r="2.1" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
  }

  return (
    <svg className={iconClass} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 3V17M3 10H17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export default function PlatformShell({ title, auth, onLogout, children }) {
  const pathname = usePathname();

  if (!auth) {
    return <div className="p-8 text-sm text-slate-500">Loading dashboard...</div>;
  }

  const apiKeyPreview = auth.apiKey ? `${auth.apiKey.slice(0, 16)}...` : "not issued yet";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-slate-50/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <img src="/RailBridge-Logo.png" alt="RailBridge" className="h-10 w-10 rounded-sm object-contain" draggable={false} />
            <span className="text-[15px] font-semibold tracking-tight">RailBridge Merchant OS</span>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 shadow-sm">
            Merchant: <span className="font-mono">{auth.merchantId}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1280px] px-6 pb-8 pt-8">
        <section className="grid min-h-[650px] gap-4 lg:grid-cols-[290px_1fr]">
          <aside className="flex flex-col rounded-[26px] border border-slate-200 bg-slate-100 p-4 shadow-panel">
            <div className="rounded-2xl border border-slate-200 bg-white px-3.5 py-3">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-rail-500 to-rail-700 text-xs font-bold uppercase text-white">
                  RB
                </span>
                <div>
                  <div className="text-lg font-semibold leading-none tracking-tight">RailBridge</div>
                  <div className="mt-1 text-[11px] text-slate-500">Merchant OS</div>
                </div>
              </div>
            </div>

            {NAV_SECTIONS.map((section) => (
              <div key={section.label} className="mt-4">
                <div className="px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{section.label}</div>
                <div className="mt-2 grid gap-1.5">
                  {section.items.map((item) => {
                    const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={classNames(
                          "flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-sm font-medium transition",
                          isActive
                            ? "border-slate-200 bg-white text-rail-800 shadow-sm"
                            : "border-transparent bg-transparent text-slate-700 hover:border-slate-200 hover:bg-white/80"
                        )}
                      >
                        <span
                          className={classNames(
                            "inline-flex h-6 w-6 items-center justify-center rounded-full border",
                            isActive ? "border-slate-200 bg-slate-50" : "border-slate-200 bg-white"
                          )}
                        >
                          <NavIcon kind={item.icon} active={isActive} />
                        </span>
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="mt-auto pt-4">
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">API key</p>
                <p className="mt-1 font-mono text-[11px] text-slate-600">{apiKeyPreview}</p>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Logout
              </button>
            </div>
          </aside>

          <section className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-panel">
            <header className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">RailBridge Console</p>
                <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Team access controls enabled
              </div>
            </header>
            <div>
              {children}
            </div>
          </section>
        </section>
      </main>
    </div>
  );
}
