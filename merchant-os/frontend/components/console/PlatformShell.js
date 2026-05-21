"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiWithSession, saveAuth } from "../../lib/platformClient";
import AddressBookIcon from "./AddressBookIcon";

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
      { href: "/settlements", label: "Activity", icon: "history" },
      { href: "/products", label: "Products", icon: "box" },
      { href: "/payouts", label: "Payouts", icon: "cash" },
      { href: "/address-book", label: "Address Book", icon: "book" }
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
      <svg className={iconClass} viewBox="0 0 2048 2048" fill="none" aria-hidden="true">
        <path
          fill="currentColor"
          d="M2048 512v1536H0V512h517q-2-16-3-32t-2-32q0-93 35-174t96-143t142-96T960 0q93 0 174 35t143 96t96 142t35 175q0 16-1 32t-4 32h645zM960 128q-66 0-124 25t-102 69t-69 102t-25 124q0 66 25 124t68 102t102 69t125 25q66 0 124-25t101-68t69-102t26-125q0-66-25-124t-69-101t-102-69t-124-26zm960 512h-555q-25 52-62 97t-85 77q103 40 186 106t140 152t89 188t31 212v64h-128v-64q0-123-44-228t-121-183t-182-121t-229-44q-111 0-210 38t-176 107t-126 162t-61 205h648l-230-230l91-90l384 384l-384 384l-91-90l230-230H256v-64q0-110 31-211t90-187t141-152t185-107q-98-69-148-175H128v1280h1792V640z"
        />
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
      <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          fill="currentColor"
          d="M18.5 17.8v-2.3q0-.2-.15-.35T18 15q-.2 0-.35.15t-.15.35v2.3q0 .2.075.375t.225.325l1.525 1.525q.15.15.35.15t.35-.15q.15-.15.15-.35t-.15-.35L18.5 17.8ZM5 21q-.825 0-1.413-.588T3 19V5q0-.825.588-1.413T5 3h14q.825 0 1.413.588T21 5v6.7q-.475-.225-.975-.388T19 11.075V5H5v14h6.05q.075.55.238 1.05t.387.95H5Zm0-3v1V5v6.075V11v7Zm2-2q0 .425.288.713T8 17h3.075q.075-.525.238-1.025t.362-.975H8q-.425 0-.713.288T7 16Zm0-4q0 .425.288.713T8 13h5.1q.8-.75 1.788-1.25T17 11.075q-.225-.05-.5-.063T16 11H8q-.425 0-.713.288T7 12Zm0-4q0 .425.288.713T8 9h8q.425 0 .713-.288T17 8q0-.425-.288-.713T16 7H8q-.425 0-.713.288T7 8Zm11 15q-2.075 0-3.538-1.463T13 18q0-2.075 1.463-3.538T18 13q2.075 0 3.538 1.463T23 18q0 2.075-1.463 3.538T18 23Z"
        />
      </svg>
    );
  }

  if (kind === "box") {
    return (
      <svg className={iconClass} viewBox="0 0 2048 2048" fill="none" aria-hidden="true">
        <path
          fill="currentColor"
          d="m960 120l832 416v1040l-832 415l-832-415V536l832-416zm625 456L960 264L719 384l621 314l245-122zM960 888l238-118l-622-314l-241 120l625 312zM256 680v816l640 320v-816L256 680zm768 1136l640-320V680l-640 320v816z"
        />
      </svg>
    );
  }

  if (kind === "cash") {
    return (
      <svg className={iconClass} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path fill="currentColor" d="M15 4v8H1V4h14zm1-1H0v10h16V3z" />
        <path
          fill="currentColor"
          d="M8 5c1.7 0 3 1.3 3 3s-1.3 3-3 3h5v-1h1V6h-1V5H8zM5 8c0-1.7 1.3-3 3-3H3v1H2v4h1v1h5c-1.7 0-3-1.3-3-3z"
        />
      </svg>
    );
  }

  if (kind === "gear") {
    return (
      <svg className={iconClass} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M 9.6660156 2 L 9.1757812 4.5234375 C 8.3516137 4.8342536 7.5947862 5.2699307 6.9316406 5.8144531 L 4.5078125 4.9785156 L 2.171875 9.0214844 L 4.1132812 10.708984 C 4.0386488 11.16721 4 11.591845 4 12 C 4 12.408768 4.0398071 12.832626 4.1132812 13.291016 L 4.1132812 13.292969 L 2.171875 14.980469 L 4.5078125 19.021484 L 6.9296875 18.1875 C 7.5928951 18.732319 8.3514346 19.165567 9.1757812 19.476562 L 9.6660156 22 L 14.333984 22 L 14.824219 19.476562 C 15.648925 19.165543 16.404903 18.73057 17.068359 18.185547 L 19.492188 19.021484 L 21.826172 14.980469 L 19.886719 13.291016 C 19.961351 12.83279 20 12.408155 20 12 C 20 11.592457 19.96113 11.168374 19.886719 10.710938 L 19.886719 10.708984 L 21.828125 9.0195312 L 19.492188 4.9785156 L 17.070312 5.8125 C 16.407106 5.2676813 15.648565 4.8344327 14.824219 4.5234375 L 14.333984 2 L 9.6660156 2 z M 11.314453 4 L 12.685547 4 L 13.074219 6 L 14.117188 6.3945312 C 14.745852 6.63147 15.310672 6.9567546 15.800781 7.359375 L 16.664062 8.0664062 L 18.585938 7.40625 L 19.271484 8.5917969 L 17.736328 9.9277344 L 17.912109 11.027344 L 17.912109 11.029297 C 17.973258 11.404235 18 11.718768 18 12 C 18 12.281232 17.973259 12.595718 17.912109 12.970703 L 17.734375 14.070312 L 19.269531 15.40625 L 18.583984 16.59375 L 16.664062 15.931641 L 15.798828 16.640625 C 15.308719 17.043245 14.745852 17.36853 14.117188 17.605469 L 14.115234 17.605469 L 13.072266 18 L 12.683594 20 L 11.314453 20 L 10.925781 18 L 9.8828125 17.605469 C 9.2541467 17.36853 8.6893282 17.043245 8.1992188 16.640625 L 7.3359375 15.933594 L 5.4140625 16.59375 L 4.7285156 15.408203 L 6.265625 14.070312 L 6.0878906 12.974609 L 6.0878906 12.972656 C 6.0276183 12.596088 6 12.280673 6 12 C 6 11.718768 6.026742 11.404282 6.0878906 11.029297 L 6.265625 9.9296875 L 4.7285156 8.59375 L 5.4140625 7.40625 L 7.3359375 8.0683594 L 8.1992188 7.359375 C 8.6893282 6.9567546 9.2541467 6.6314701 9.8828125 6.3945312 L 10.925781 6 L 11.314453 4 z M 12 8 C 9.8034768 8 8 9.8034768 8 12 C 8 14.196523 9.8034768 16 12 16 C 14.196523 16 16 14.196523 16 12 C 16 9.8034768 14.196523 8 12 8 z M 12 10 C 13.111477 10 14 10.888523 14 12 C 14 13.111477 13.111477 14 12 14 C 10.888523 14 10 13.111477 10 12 C 10 10.888523 10.888523 10 12 10 z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (kind === "book") {
    return (
      <AddressBookIcon className={iconClass} />
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
              <button
                type="button"
                onClick={onLogout}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-900 bg-slate-900 px-3.5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
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
