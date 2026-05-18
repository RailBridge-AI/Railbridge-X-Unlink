"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { readAuth, saveAuth } from "../lib/platformClient";

const defaultOnboarding = {
  merchantName: "",
  adminEmail: "",
  adminPassword: "",
  complianceCountry: "US"
};

const INFO_SLIDES = [
  {
    title: "Business payments, simplified",
    subtitle: "Accept digital dollar payments in one place and view all funds in a single dashboard."
  },
  {
    title: "No wallet or network setup required",
    subtitle: "RailBridge handles blockchain complexity in the background so your team can focus on operations."
  },
  {
    title: "Guided setup to first payout",
    subtitle: "Create credentials, connect webhooks, set a paid route, run a test payment, and verify payout."
  }
];

const classNames = (...values) => values.filter(Boolean).join(" ");

export default function HomePage() {
  const router = useRouter();
  const [mode, setMode] = useState("onboarding");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [infoSlide, setInfoSlide] = useState(0);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [form, setForm] = useState(defaultOnboarding);

  useEffect(() => {
    const auth = readAuth();
    if (auth) {
      router.replace("/onboarding");
    }
  }, [router]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setInfoSlide((current) => (current + 1) % INFO_SLIDES.length);
    }, 7000);
    return () => window.clearInterval(timer);
  }, []);

  const handleOnboard = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/v1/onboarding/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          merchantName: form.merchantName,
          adminEmail: form.adminEmail,
          adminPassword: form.adminPassword,
          complianceProfile: {
            country: form.complianceCountry,
            completedAt: new Date().toISOString()
          }
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
      }

      saveAuth({
        token: payload.token,
        apiKey: payload.apiKey,
        merchantId: payload.merchantId,
        accountId: payload.accountId
      });
      router.replace("/onboarding");
    } catch (nextError) {
      setError(nextError.message || "Onboarding failed");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
      }
      saveAuth({
        token: payload.token,
        apiKey: payload.apiKey,
        merchantId: payload.merchantId,
        accountId: payload.accountId
      });
      router.replace("/onboarding");
    } catch (nextError) {
      setError(nextError.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-slate-50/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <img src="/RailBridge-Logo.png" alt="RailBridge" className="h-10 w-10 rounded-sm object-contain" draggable={false} />
            <span className="text-[15px] font-semibold tracking-tight">RailBridge Merchant OS</span>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 shadow-sm">
            Custodial USDC payments platform
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1280px] px-6 pb-8 pt-8">
        <section className="grid min-h-[calc(100vh-8rem)] grid-cols-1 overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-panel lg:grid-cols-2">
          <section className="relative overflow-hidden border-b border-slate-200 px-6 py-10 lg:border-b-0 lg:border-r lg:px-10 lg:py-12">
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <span className="absolute left-[10%] top-[15%] h-20 w-20 rounded-full bg-black/5 blur-xl"></span>
              <span className="absolute right-[20%] top-[30%] h-16 w-16 rounded-full bg-slate-400/10 blur-xl"></span>
              <span className="absolute bottom-[25%] left-[25%] h-12 w-12 rounded-full bg-black/5 blur-xl"></span>
              <span className="absolute right-[15%] bottom-[20%] h-14 w-14 rounded-full bg-slate-400/10 blur-xl"></span>
            </div>

            <div className="relative z-10 flex h-full flex-col justify-end">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rail-700">RailBridge Platform</p>
                <h1 className="mt-3 text-3xl font-semibold leading-tight text-slate-900 sm:text-4xl">Accept agent payments. Settle in USDC.</h1>
                <p className="mt-3 max-w-lg text-sm leading-relaxed text-slate-600">One API and SDK to accept USDC payments with clear settlement and payout operations.</p>

                <div className="mt-8">
                  <h2 className="text-2xl font-semibold leading-tight text-slate-900">{INFO_SLIDES[infoSlide].title}</h2>
                  <p className="mt-3 max-w-lg text-sm leading-relaxed text-slate-600">{INFO_SLIDES[infoSlide].subtitle}</p>
                  <div className="mt-6 flex gap-2">
                    {INFO_SLIDES.map((_, index) => (
                      <button
                        key={index}
                        type="button"
                        aria-label={`Slide ${index + 1}`}
                        onClick={() => setInfoSlide(index)}
                        className={classNames(
                          "h-2 w-2 rounded-full transition",
                          index === infoSlide ? "scale-110 bg-slate-900" : "bg-slate-300 hover:bg-slate-400"
                        )}
                      ></button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="flex flex-col items-center justify-center bg-white px-6 py-10 lg:px-12 lg:py-12">
            <div className="w-full max-w-sm">
              <img src="/RailBridge-Logo.png" alt="" className="mx-auto h-12 w-12 rounded-lg object-contain" />
              <h2 className="mt-6 text-center text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
                {mode === "onboarding" ? "Create your merchant account" : "Welcome back"}
              </h2>
              <p className="mt-2 text-center text-sm text-slate-500">
                {mode === "onboarding"
                  ? "Start onboarding to generate API credentials and launch your first paid endpoint."
                  : "Sign in to continue managing settlements, products, payouts, and team settings."}
              </p>

              <div className="mb-4 mt-6 flex rounded-xl border border-slate-200 bg-slate-100 p-1 text-sm">
                <button
                  type="button"
                  className={classNames(
                    "flex-1 rounded-lg px-3 py-2 font-medium transition",
                    mode === "onboarding" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
                  )}
                  onClick={() => setMode("onboarding")}
                >
                  Onboarding
                </button>
                <button
                  type="button"
                  className={classNames(
                    "flex-1 rounded-lg px-3 py-2 font-medium transition",
                    mode === "login" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
                  )}
                  onClick={() => setMode("login")}
                >
                  Login
                </button>
              </div>

              {mode === "onboarding" ? (
                <form className="space-y-3" onSubmit={handleOnboard}>
                  <label className="block text-xs font-medium text-slate-700">
                    Business Name
                    <input
                      className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-rail-500 focus:ring-2 focus:ring-rail-200"
                      placeholder="Acme Robotics LLC"
                      value={form.merchantName}
                      onChange={(event) => setForm((curr) => ({ ...curr, merchantName: event.target.value }))}
                      required
                    />
                  </label>
                  <label className="block text-xs font-medium text-slate-700">
                    Admin Email
                    <input
                      className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-rail-500 focus:ring-2 focus:ring-rail-200"
                      placeholder="admin@acme.com"
                      type="email"
                      value={form.adminEmail}
                      onChange={(event) => setForm((curr) => ({ ...curr, adminEmail: event.target.value }))}
                      required
                    />
                  </label>
                  <label className="block text-xs font-medium text-slate-700">
                    Password
                    <input
                      className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-rail-500 focus:ring-2 focus:ring-rail-200"
                      placeholder="********"
                      type="password"
                      value={form.adminPassword}
                      onChange={(event) => setForm((curr) => ({ ...curr, adminPassword: event.target.value }))}
                      required
                    />
                  </label>
                  <label className="block text-xs font-medium text-slate-700">
                    Compliance Country
                    <input
                      className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-rail-500 focus:ring-2 focus:ring-rail-200"
                      placeholder="US"
                      value={form.complianceCountry}
                      onChange={(event) => setForm((curr) => ({ ...curr, complianceCountry: event.target.value }))}
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-xl border border-rail-700 bg-gradient-to-br from-rail-700 to-rail-800 px-4 py-3 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-65"
                  >
                    {loading ? "Creating account..." : "Create Merchant Account"}
                  </button>
                </form>
              ) : (
                <form className="space-y-3" onSubmit={handleLogin}>
                  <label className="block text-xs font-medium text-slate-700">
                    Email
                    <input
                      className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-rail-500 focus:ring-2 focus:ring-rail-200"
                      placeholder="admin@acme.com"
                      type="email"
                      value={loginEmail}
                      onChange={(event) => setLoginEmail(event.target.value)}
                      required
                    />
                  </label>
                  <label className="block text-xs font-medium text-slate-700">
                    Password
                    <input
                      className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-rail-500 focus:ring-2 focus:ring-rail-200"
                      placeholder="********"
                      type="password"
                      value={loginPassword}
                      onChange={(event) => setLoginPassword(event.target.value)}
                      required
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-xl border border-rail-700 bg-gradient-to-br from-rail-700 to-rail-800 px-4 py-3 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-65"
                  >
                    {loading ? "Signing in..." : "Sign in"}
                  </button>
                </form>
              )}

              {error ? <p className="mt-4 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
            </div>
          </section>
        </section>
      </main>
    </div>
  );
}
