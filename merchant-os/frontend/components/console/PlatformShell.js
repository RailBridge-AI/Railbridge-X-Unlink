"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiWithSession, saveAuth } from "../../lib/platformClient";

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

const initialsFromName = (value) => {
  const parts = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) {
    return "ME";
  }
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
};

const shortId = (value) => {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (text.length <= 14) {
    return text;
  }
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
};

const normalizeProfileFromAuth = (auth) => ({
  merchantName: String(auth?.merchantName || "").trim(),
  accountName: String(auth?.accountName || "").trim(),
  userEmail: String(auth?.user?.email || "").trim(),
  userRole: String(auth?.user?.role || "").trim().toLowerCase() || "admin"
});

const normalizeRoleLabel = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "ADMIN";
  }
  return normalized.toUpperCase();
};

function NavIcon({ kind, active }) {
  const iconClass = classNames(
    "h-3.5 w-3.5",
    active ? "text-white" : "text-slate-500"
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
  const [profile, setProfile] = useState(() => normalizeProfileFromAuth(auth));
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileForm, setProfileForm] = useState({
    merchantName: "",
    accountName: "",
    userEmail: ""
  });

  useEffect(() => {
    setProfile(normalizeProfileFromAuth(auth));
  }, [auth]);

  useEffect(() => {
    if (!profileModalOpen) {
      return;
    }

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setProfileModalOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [profileModalOpen]);

  const merchantName = String(profile.merchantName || "").trim() || "Merchant Workspace";
  const accountName = String(profile.accountName || "").trim() || "Primary Treasury";
  const userEmail = String(profile.userEmail || "").trim();
  const userRole = String(profile.userRole || "").trim().toLowerCase() || "admin";

  const hasProfileChanges = useMemo(() => {
    const initialEmail = String(userEmail || "").trim().toLowerCase();
    const nextEmail = String(profileForm.userEmail || "").trim().toLowerCase();
    return (
      String(profileForm.merchantName || "").trim() !== merchantName ||
      String(profileForm.accountName || "").trim() !== accountName ||
      nextEmail !== initialEmail
    );
  }, [accountName, merchantName, profileForm, userEmail]);

  if (!auth) {
    return <div className="p-8 text-sm text-slate-500">Loading dashboard...</div>;
  }

  const apiKeyPreview = auth.apiKey ? `${auth.apiKey.slice(0, 16)}...` : "not issued yet";
  const userRoleLabel = normalizeRoleLabel(userRole);
  const merchantIdPreview = shortId(auth.merchantId);
  const profileInitials = initialsFromName(merchantName);

  const openProfileModal = () => {
    setProfileError("");
    setProfileForm({
      merchantName,
      accountName,
      userEmail
    });
    setProfileModalOpen(true);
  };

  const closeProfileModal = () => {
    if (profileBusy) {
      return;
    }
    setProfileModalOpen(false);
    setProfileError("");
  };

  const saveProfileChanges = async (event) => {
    event.preventDefault();
    if (!auth?.token || profileBusy) {
      return;
    }

    const nextMerchantName = String(profileForm.merchantName || "").trim();
    const nextAccountName = String(profileForm.accountName || "").trim();
    const nextUserEmail = String(profileForm.userEmail || "").trim().toLowerCase();

    if (nextMerchantName.length < 2) {
      setProfileError("Merchant name must be at least 2 characters.");
      return;
    }
    if (nextAccountName.length < 2) {
      setProfileError("Treasury name must be at least 2 characters.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextUserEmail)) {
      setProfileError("Enter a valid contact email.");
      return;
    }
    if (!hasProfileChanges) {
      setProfileModalOpen(false);
      return;
    }

    setProfileBusy(true);
    setProfileError("");
    try {
      const payload = await apiWithSession({
        token: auth.token,
        path: "/v1/onboarding/profile",
        method: "PATCH",
        body: {
          merchantName: nextMerchantName,
          accountName: nextAccountName,
          userEmail: nextUserEmail
        }
      });

      const nextProfile = {
        merchantName: String(payload.merchantName || nextMerchantName).trim(),
        accountName: String(payload.accountName || nextAccountName).trim(),
        userEmail: String(payload.user?.email || nextUserEmail).trim(),
        userRole: String(payload.user?.role || userRole).trim().toLowerCase() || "admin"
      };
      setProfile(nextProfile);
      setProfileModalOpen(false);

      saveAuth({
        ...auth,
        merchantName: nextProfile.merchantName,
        accountName: nextProfile.accountName,
        user: {
          ...(auth.user || {}),
          email: nextProfile.userEmail,
          role: nextProfile.userRole
        }
      });
    } catch (nextError) {
      setProfileError(nextError.message || "Failed to update profile");
    } finally {
      setProfileBusy(false);
    }
  };

  return (
    <div className="min-h-screen text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200/70 rb-surface">
        <div className="mx-auto flex h-16 w-full max-w-[1320px] items-center px-6">
          <div className="flex items-center gap-3">
            <img src="/RailBridge-Logo.png" alt="RailBridge" className="h-10 w-10 rounded-sm object-contain" draggable={false} />
            <span className="text-[15px] font-semibold tracking-tight text-slate-950">RailBridge Merchant OS</span>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1320px] px-6 pb-8 pt-8">
        <section className="grid min-h-[650px] gap-4 lg:grid-cols-[300px_1fr]">
          <aside className="rb-fade-up flex flex-col rounded-[28px] border border-slate-200/90 rb-surface p-4 rb-panel-elevated">
            <button
              type="button"
              onClick={openProfileModal}
              className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-900 via-slate-800 to-rail-800 px-3.5 py-3 text-left text-white transition hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-cyan-300/60"
            >
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.16),transparent_42%)]"></div>
              <div className="relative z-10 flex items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/20 bg-white/15 text-xs font-bold uppercase text-white">
                    {profileInitials}
                  </span>
                  <div>
                    <div className="text-sm font-semibold leading-tight tracking-tight">{merchantName}</div>
                    <div className="mt-1 text-[11px] text-slate-200">{accountName}</div>
                  </div>
                </div>
                <span className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-100">
                  {userRoleLabel}
                </span>
              </div>
              <div className="relative z-10 mt-2 space-y-0.5 border-t border-white/15 pt-2 text-[11px] text-slate-200">
                <p className="truncate">{userEmail || `Merchant ${merchantIdPreview}`}</p>
                <p className="font-mono text-[10px] text-slate-300">{merchantIdPreview}</p>
              </div>
            </button>

            {NAV_SECTIONS.map((section) => (
              <div key={section.label} className="mt-4">
                <div className="px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{section.label}</div>
                <div className="rb-fade-up rb-fade-delay-1 mt-2 grid gap-1.5">
                  {section.items.map((item) => {
                    const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={classNames(
                          "flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-sm font-medium transition duration-200",
                          isActive
                            ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                            : "border-transparent bg-transparent text-slate-700 hover:border-slate-200 hover:bg-white/80"
                        )}
                      >
                        <span
                          className={classNames(
                            "inline-flex h-6 w-6 items-center justify-center rounded-full border",
                            isActive ? "border-white/20 bg-white/10" : "border-slate-200 bg-white"
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
              <div className="rounded-xl border border-slate-200 bg-white/90 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Current API key</p>
                <p className="mt-1 font-mono text-[11px] text-slate-700">{apiKeyPreview}</p>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-900 bg-slate-900 px-3.5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
              >
                Logout
              </button>
            </div>
          </aside>

          <section className="rb-fade-up rb-fade-delay-1 rounded-[28px] border border-slate-200/90 rb-surface p-5 shadow-panel">
            <header className="mb-4 border-b border-slate-200/90 pb-3">
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-slate-500">RailBridge Console</p>
                <h2 className="text-[2rem] font-semibold tracking-tight text-slate-950">{title}</h2>
              </div>
            </header>
            <div className="rb-fade-up rb-fade-delay-2">
              {children}
            </div>
          </section>
        </section>
      </main>

      {profileModalOpen ? (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
          onClick={closeProfileModal}
        >
          <div
            className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Merchant Profile</p>
                <h3 className="mt-1 text-xl font-semibold text-slate-950">Update workspace details</h3>
              </div>
              <button
                type="button"
                onClick={closeProfileModal}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            <form className="mt-4 space-y-3" onSubmit={saveProfileChanges}>
              <label className="block text-xs font-medium text-slate-700">
                Merchant Name
                <input
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-rail-500 focus:ring-2 focus:ring-rail-200"
                  value={profileForm.merchantName}
                  onChange={(event) =>
                    setProfileForm((current) => ({ ...current, merchantName: event.target.value }))
                  }
                  required
                />
              </label>

              <label className="block text-xs font-medium text-slate-700">
                Treasury Name
                <input
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-rail-500 focus:ring-2 focus:ring-rail-200"
                  value={profileForm.accountName}
                  onChange={(event) =>
                    setProfileForm((current) => ({ ...current, accountName: event.target.value }))
                  }
                  required
                />
              </label>

              <label className="block text-xs font-medium text-slate-700">
                Contact Email
                <input
                  type="email"
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-rail-500 focus:ring-2 focus:ring-rail-200"
                  value={profileForm.userEmail}
                  onChange={(event) =>
                    setProfileForm((current) => ({ ...current, userEmail: event.target.value }))
                  }
                  required
                />
              </label>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Access role: <span className="font-semibold text-slate-800">{userRoleLabel}</span>
              </div>

              {profileError ? (
                <p className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {profileError}
                </p>
              ) : null}

              <div className="flex flex-wrap justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeProfileModal}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={profileBusy || !hasProfileChanges}
                  className="rounded-xl border border-rail-700 bg-gradient-to-br from-rail-700 to-rail-800 px-3 py-2 text-sm font-semibold text-white hover:brightness-105 disabled:opacity-60"
                >
                  {profileBusy ? "Saving..." : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
