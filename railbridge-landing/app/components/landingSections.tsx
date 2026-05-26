"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const merchantOsFeatures = [
  {
    id: "overview",
    title: "Treasury Overview",
    summary:
      "Monitor balances and total position across merchant accounts from one screen.",
    screenshot: "/merchant-os-screenshots/overview.png",
    alt: "Merchant OS overview dashboard",
  },
  {
    id: "activity",
    title: "Transaction Activity",
    summary:
      "Track lifecycle status for incoming, outgoing payments and cross-chain settlement events.",
    screenshot: "/merchant-os-screenshots/activity.png",
    alt: "Merchant OS settlement activity timeline",
  },
  {
    id: "products",
    title: "Product Configuration",
    summary:
      "Create paid routes, define pricing, and control how settlement should be handled.",
    screenshot: "/merchant-os-screenshots/products.png",
    alt: "Merchant OS products configuration page",
  },
  {
    id: "payouts",
    title: "Payout Operations",
    summary:
      "Execute payout requests with visibility into status, amount, and destination.",
    screenshot: "/merchant-os-screenshots/payout.png",
    alt: "Merchant OS payouts operations page",
  },
] as const;
type MerchantOsFeatureId = (typeof merchantOsFeatures)[number]["id"];

// Simple Chain Badge (text-based so you can swap easily)
function ChainBadge({ label, darkMode }: { label: string; darkMode: boolean }) {
  return (
    <div
      className={`px-3 py-1 rounded-full backdrop-blur text-xs shadow-sm ${
        darkMode
          ? "border border-white/30 bg-white/5 text-white/90"
          : "border border-black/30 bg-black/5 text-black/90"
      }`}
    >
      {label}
    </div>
  );
}

// Horizontal sliding row of chain logos
function SlidingRow({
  items,
  direction = "left",
  duration = 20,
  gap = 80,
  darkMode = false,
}: {
  items: Array<{ src: string; alt: string }>;
  direction?: "left" | "right";
  duration?: number;
  gap?: number;
  darkMode?: boolean;
}) {
  // Duplicate items for seamless loop
  const duplicatedItems = [...items, ...items];
  const itemWidth = 60; // width of each logo container
  const totalWidth = items.length * (itemWidth + gap);

  return (
    <div className="relative overflow-hidden w-full h-16">
      <motion.div
        style={{
          display: "flex",
          alignItems: "center",
          gap: gap,
          position: "absolute",
          width: totalWidth * 2,
        }}
        animate={{
          x: direction === "left" ? [-totalWidth, 0] : [0, -totalWidth],
        }}
        transition={{
          repeat: Infinity,
          ease: "linear",
          duration,
        }}
      >
        {duplicatedItems.map((item, idx) => (
          <div
            key={idx}
            className="flex-shrink-0 flex items-center justify-center"
            style={{ width: itemWidth }}
          >
            <div
              className={`size-14 rounded-full backdrop-blur flex items-center justify-center shadow-sm ${
                darkMode
                  ? "border border-white/20 bg-white/5"
                  : "border border-black/20 bg-black/5"
              }`}
            >
              <img
                src={item.src}
                alt={item.alt}
                className="w-8 h-8 object-contain"
                draggable={false}
              />
            </div>
          </div>
        ))}
      </motion.div>
    </div>
  );
}

function ChainSlides({ darkMode }: { darkMode: boolean }) {
  const chains = [
    { src: "/token-logos/base.png", alt: "Base" },
    { src: "/token-logos/arbitrum.svg", alt: "Arbitrum" },
    { src: "/token-logos/optimism.svg", alt: "Optimism" },
    { src: "/token-logos/polygon.svg", alt: "Polygon" },
    { src: "/token-logos/ethereum.svg", alt: "Ethereum" },
    { src: "/token-logos/bsc.svg", alt: "BSC" },
    { src: "/token-logos/avax.png", alt: "Avalanche" },
    { src: "/token-logos/hype.png", alt: "Hyperbridge" },
    { src: "/token-logos/solana.png", alt: "Solana" },
    { src: "/token-logos/sonic.png", alt: "Sonic" },
    { src: "/token-logos/monad.png", alt: "Monad" },
    { src: "/token-logos/ink.png", alt: "Ink" },
    { src: "/token-logos/Linea.png", alt: "Linea" },
    { src: "/token-logos/sei.png", alt: "Sei" },
    { src: "/token-logos/starknet.png", alt: "Starknet" },
    { src: "/token-logos/unichain.svg", alt: "Unichain" },
    { src: "/token-logos/worldcoin.svg", alt: "Worldcoin" },
    { src: "/token-logos/plume.svg", alt: "Plume" },
  ];

  return (
    <div className="relative w-full max-w-5xl mx-auto py-12">
      {/* Sliding rows */}
      <div className="relative space-y-8">
        {/* Row 1 - Left */}
        <SlidingRow
          items={chains.slice(0, 5)}
          direction="left"
          duration={25}
          darkMode={darkMode}
        />

        {/* Row 2 - Right */}
        <SlidingRow
          items={chains.slice(5, 10)}
          direction="right"
          duration={30}
          darkMode={darkMode}
        />

        {/* Row 3 - Left (faster) */}
        <SlidingRow
          items={chains.slice(10, 15)}
          direction="left"
          duration={20}
          darkMode={darkMode}
        />
      </div>
    </div>
  );
}

function FlowDiagram({ darkMode }: { darkMode: boolean }) {
  const steps = [
    {
      label: "Accept",
      title: "Customers and agents pay through x402",
      body: "Your paid routes stay simple while payers use supported networks they already prefer.",
    },
    {
      label: "Route",
      title: "RailBridge coordinates routing and settlement",
      body: "The facilitator handles cross-chain movement and settlement lifecycle events behind the scenes.",
    },
    {
      label: "Operate",
      title: "Merchant OS keeps finance and ops in control",
      body: "Track balances, settlements, policies, and payouts from one operational control plane.",
    },
  ];

  const arrowColor = darkMode ? "border-white/70" : "border-black/60";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col md:flex-row md:items-center md:gap-4">
        {steps.map((step, index) => (
          <div
            key={step.label}
            className="flex-1 flex flex-col md:flex-row md:items-center"
          >
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.4, delay: index * 0.1 }}
              {...{
                className: `w-full rounded-2xl border p-4 sm:p-5 ${
                  darkMode
                    ? "border-white/15 bg-white/[0.02]"
                    : "border-black/10 bg-black/[0.02]"
                }`,
              }}
            >
              <div className="flex items-center gap-2 mb-2 text-xs uppercase tracking-wide">
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${
                    darkMode
                      ? "bg-white/10 text-white"
                      : "bg-black/5 text-black"
                  }`}
                >
                  {index + 1}
                </span>
                <span className={darkMode ? "text-white/70" : "text-black/70"}>
                  {step.label}
                </span>
              </div>
              <h3
                className={`text-sm sm:text-base font-semibold mb-1 ${
                  darkMode ? "text-white" : "text-black"
                }`}
              >
                {step.title}
              </h3>
              <p
                className={`text-xs sm:text-sm leading-relaxed ${
                  darkMode ? "text-white/70" : "text-black/70"
                }`}
              >
                {step.body}
              </p>
            </motion.div>

            {/* Arrow between cards on desktop */}
            {index < steps.length - 1 && (
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ duration: 0.4, delay: index * 0.1 }}
                {...{
                  className:
                    "hidden md:flex items-center justify-center mx-4",
                }}
              >
                <div
                  className={`h-px w-16 border-t-2 ${arrowColor} relative overflow-visible`}
                >
                  <span
                    className={`block absolute inset-y-0 left-0 w-16 ${
                      darkMode ? "bg-white/40" : "bg-black/40"
                    }`}
                  />
                  <div className="absolute -right-3 top-1/2 -translate-y-1/2">
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      className={darkMode ? "text-white" : "text-black"}
                      aria-hidden="true"
                    >
                      <path
                        d="M2 2l8 4-8 4z"
                        fill="currentColor"
                      />
                    </svg>
                  </div>
                </div>
              </motion.div>
            )}
            {/* Arrow between cards on mobile */}
            {index < steps.length - 1 && (
              <div className="flex md:hidden items-center justify-center my-4">
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.4 }}
                  transition={{ duration: 0.4, delay: index * 0.1 }}
                  {...{
                    className: `h-12 w-px border-l-2 ${arrowColor} relative overflow-visible`,
                  }}
                >
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-[6px]">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      className={darkMode ? "text-white" : "text-black"}
                      aria-hidden="true"
                    >
                      <path d="M2 4l5 8 5-8z" fill="currentColor" />
                    </svg>
                  </div>
                </motion.div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Section({
  id,
  title,
  subtitle,
  children,
  darkMode,
  inverted = false,
}: any) {
  const sectionColors = inverted
    ? darkMode
      ? "bg-white text-black"
      : "bg-black text-white"
    : "";

  const selectionClasses = inverted
    ? darkMode
      ? "selection:bg-black/10 selection:text-black"
      : "selection:bg-white/20 selection:text-white"
    : "";

  return (
    <section
      id={id}
      className={`relative py-20 sm:py-28 transition-colors ${sectionColors} ${selectionClasses}`}
    >
      <div className="max-w-6xl mx-auto px-6">
        <div className="mb-8">
          <h2
            className={`text-2xl sm:text-3xl md:text-4xl font-semibold ${
              inverted
                ? darkMode
                  ? "text-black"
                  : "text-white"
                : darkMode
                  ? "text-white"
                  : "text-black"
            }`}
          >
            {title}
          </h2>
          {subtitle && (
            <p
              className={`mt-3 max-w-3xl ${
                inverted
                  ? darkMode
                    ? "text-black/70"
                    : "text-white/70"
                  : darkMode
                    ? "text-white/70"
                    : "text-black/70"
              }`}
            >
              {subtitle}
            </p>
          )}
        </div>
        {children}
      </div>
    </section>
  );
}

export function HeaderSection({
  darkMode,
  onToggleDarkMode,
}: {
  darkMode: boolean;
  onToggleDarkMode: () => void;
}) {
  const handleNavClick = (event: any, targetId: string) => {
    event.preventDefault();
    const el = document.getElementById(targetId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <header
      className={`sticky top-0 z-40 border-b backdrop-blur transition-colors ${
        darkMode ? "border-white/20 bg-black/80" : "border-black/20 bg-white/80"
      }`}
    >
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img
            src="/RailBridge-Logo.png"
            alt="RailBridge AI"
            className="w-10 h-10 rounded-sm object-contain"
            draggable={false}
          />
          <span className="font-bold tracking-tight">RailBridge AI</span>
        </div>
        <div className="flex items-center gap-3">
          <nav
            className={`hidden sm:flex items-center gap-6 text-sm ${
              darkMode ? "text-white/70" : "text-black/70"
            }`}
          >
            <a
              href="#problem"
              onClick={(e) => handleNavClick(e, "problem")}
              className={darkMode ? "hover:text-white" : "hover:text-black"}
            >
              Problem
            </a>
            <a
              href="#solution"
              onClick={(e) => handleNavClick(e, "solution")}
              className={darkMode ? "hover:text-white" : "hover:text-black"}
            >
              Solution
            </a>
            <a
              href="#merchant-os"
              onClick={(e) => handleNavClick(e, "merchant-os")}
              className={darkMode ? "hover:text-white" : "hover:text-black"}
            >
              Merchant OS
            </a>
            <a
              href="#audience"
              onClick={(e) => handleNavClick(e, "audience")}
              className={darkMode ? "hover:text-white" : "hover:text-black"}
            >
              Who It&apos;s For
            </a>
            <a
              href="#faq"
              onClick={(e) => handleNavClick(e, "faq")}
              className={darkMode ? "hover:text-white" : "hover:text-black"}
            >
              FAQ
            </a>
            <a
              href="https://railbridge.gitbook.io/docs"
              target="_blank"
              rel="noopener noreferrer"
              className={darkMode ? "hover:text-white" : "hover:text-black"}
            >
              Docs
            </a>
          </nav>
          <button
            onClick={onToggleDarkMode}
            className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${
              darkMode
                ? "bg-gray-800 focus:ring-white/50"
                : "bg-gray-200 focus:ring-black/50"
            }`}
            aria-label="Toggle dark mode"
            role="switch"
            aria-checked={darkMode}
          >
            {/* Moon icon - visible in dark mode */}
            <svg
              className={`absolute left-1.5 h-4 w-4 transition-opacity ${
                darkMode ? "opacity-100 text-white" : "opacity-0"
              }`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
            </svg>

            {/* Sun icon - visible in light mode */}
            <svg
              className={`absolute right-1.5 h-4 w-4 transition-opacity ${
                darkMode ? "opacity-0" : "opacity-100 text-gray-800"
              }`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
                clipRule="evenodd"
              />
            </svg>

            {/* Thumb */}
            <span
              className={`inline-block h-5 w-5 transform rounded-full transition-transform shadow-md ${
                darkMode ? "translate-x-8 bg-white" : "translate-x-1 bg-white"
              }`}
            />
          </button>
        </div>
      </div>
    </header>
  );
}

export function HeroSection({ darkMode }: { darkMode: boolean }) {
  return (
    <section className="relative overflow-hidden min-h-[calc(100vh-3.5rem)] flex items-center">
      {/* Background gradient */}
      <div
        className={`absolute inset-0 -z-10 transition-colors ${
          darkMode
            ? "bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.03),transparent_40%),radial-gradient(ellipse_at_bottom,rgba(255,255,255,0.02),transparent_45%)]"
            : "bg-[radial-gradient(ellipse_at_top,rgba(0,0,0,0.03),transparent_40%),radial-gradient(ellipse_at_bottom,rgba(0,0,0,0.02),transparent_45%)]"
        }`}
      />

      <div className="max-w-6xl mx-auto px-6 py-10 sm:py-12 md:py-16">
        <div className="grid md:grid-cols-2 gap-10 items-center">
          <div>
            <h1 className="text-3xl sm:text-5xl md:text-6xl font-semibold leading-tight">
              Merchant Operating System{" "}
              <span className={darkMode ? "text-white" : "text-black"}>
                for AI Agent Payments
              </span>
            </h1>
            <p
              className={`mt-5 max-w-xl transition-colors ${
                darkMode ? "text-white/70" : "text-black/70"
              }`}
            >
              Accept cross-chain USDC from agents and users, then manage
              settlement and payouts in one control plane for business and
              developer teams.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a
                href="https://railbridge.gitbook.io/docs"
                target="_blank"
                rel="noopener noreferrer"
                className={`px-4 py-2.5 font-medium transition-colors ${
                  darkMode
                    ? "bg-white hover:bg-white/90 text-black"
                    : "bg-black hover:bg-black/90 text-white"
                }`}
              >
                Read Docs{" "}
              </a>
              <a
                href="https://tally.so/r/PdzO01"
                target="_blank"
                rel="noopener noreferrer"
                className={`px-4 py-2.5 border transition-colors ${
                  darkMode
                    ? "border-white/30 hover:bg-white/10"
                    : "border-black/30 hover:bg-black/10"
                }`}
              >
                Join Waitlist
              </a>
            </div>
          </div>

          <div className="flex justify-center mt-8 sm:mt-0">
            <ChainSlides darkMode={darkMode} />
          </div>
        </div>
      </div>
    </section>
  );
}

export function ProblemSection({ darkMode }: { darkMode: boolean }) {
  return (
    <Section
      id="problem"
      title="Why Merchant Teams Get Stuck"
      subtitle="Growth in onchain payments usually creates scattered balances, manual reconciliation, and operational risk for finance and ops."
      darkMode={darkMode}
      inverted
    >
      <div className="grid md:grid-cols-3 gap-6">
        {[
          {
            h: "Revenue Is Fragmented",
            p: "Payments land across multiple chains and addresses, making it hard to maintain a single cash position.",
          },
          {
            h: "Reconciliation Is Manual",
            p: "Teams piece together explorer data, bridge events, and internal logs before they can trust reporting.",
          },
          {
            h: "Operations Don’t Scale",
            p: "Payout execution, controls, and auditability become fragile when payment infrastructure is stitched together.",
          },
        ].map((card, i) => (
          <div
            key={i}
            className={`rounded-3xl border p-6 sm:p-7 shadow-sm transition-colors ${
              darkMode
                ? "border-black/10 bg-black/[0.02]"
                : "border-white/10 bg-white/[0.02]"
            }`}
          >
            <div className="flex flex-col h-full">
              <div className="mb-6">
                <div
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${
                    darkMode
                      ? "bg-black/5"
                      : "bg-white/60"
                  }`}
                >
                  <img
                    src={
                      i === 0
                        ? "/images/blockchain.png"
                        : i === 1
                          ? "/images/wrench.png"
                          : "/images/shop.png"
                    }
                    alt={
                      i === 0
                        ? "Blockchain"
                        : i === 1
                          ? "Wrench"
                          : "Shop"
                    }
                    className="h-6 w-6 object-contain"
                    draggable={false}
                  />
                </div>
              </div>
              <h3
                className={`text-lg sm:text-xl font-semibold leading-snug transition-colors ${
                  darkMode ? "text-black" : "text-white"
                }`}
              >
                {card.h}
              </h3>
              <p
                className={`mt-3 text-sm leading-relaxed transition-colors ${
                  darkMode ? "text-black/70" : "text-white/70"
                }`}
              >
                {card.p}
              </p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function SolutionSection({ darkMode }: { darkMode: boolean }) {
  return (
    <Section
      id="solution"
      title="Merchant OS, Powered by RailBridge"
      subtitle="One operational layer from payment acceptance to settlement visibility and payout execution."
      darkMode={darkMode}
    >
      <div className="mt-4">
        <FlowDiagram darkMode={darkMode} />
      </div>
    </Section>
  );
}

export function AudienceSection({ darkMode }: { darkMode: boolean }) {
  return (
    <Section
      id="audience"
      title="Who This Is For"
      subtitle="RailBridge is built for teams that need stablecoin revenue operations to be reliable, auditable, and easy to run."
      darkMode={darkMode}
    >
      <div className="grid md:grid-cols-3 gap-6">
        {[
          {
            h: "API And SaaS Businesses",
            p: "Monetize paid routes with x402 while keeping finance operations in one Merchant OS control plane.",
          },
          {
            h: "AI Agent Platforms",
            p: "Support agent payments without forcing every customer into one chain or one wallet ecosystem.",
          },
          {
            h: "Marketplace And Infra Teams",
            p: "Consolidate multi-chain payment flow into clear settlement timelines and payout workflows.",
          },
        ].map((card, i) => (
          <div
            key={i}
            className={`rounded-3xl border p-6 sm:p-7 shadow-sm transition-colors ${
              darkMode
                ? "border-white/15 bg-white/[0.02]"
                : "border-black/10 bg-black/[0.02]"
            }`}
          >
            <h3
              className={`text-lg sm:text-xl font-semibold leading-snug ${
                darkMode ? "text-white" : "text-black"
              }`}
            >
              {card.h}
            </h3>
            <p
              className={`mt-3 text-sm leading-relaxed ${
                darkMode ? "text-white/70" : "text-black/70"
              }`}
            >
              {card.p}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function MerchantOsSection({ darkMode }: { darkMode: boolean }) {
  const [activeFeatureId, setActiveFeatureId] = useState<MerchantOsFeatureId>(
    merchantOsFeatures[0].id,
  );
  useEffect(() => {
    merchantOsFeatures.forEach((feature) => {
      const preloadedImage = new Image();
      preloadedImage.src = feature.screenshot;
    });
  }, []);

  const activeFeature =
    merchantOsFeatures.find((feature) => feature.id === activeFeatureId) ||
    merchantOsFeatures[0];

  return (
    <Section
      id="merchant-os"
      title="What You Get In Railbridge Merchant OS"
      subtitle=""
      darkMode={darkMode}
      inverted
    >
      <div className="space-y-6">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {merchantOsFeatures.map((feature, index) => {
            const isActive = feature.id === activeFeatureId;
            const number = String(index + 1).padStart(2, "0");
            return (
              <button
                key={feature.id}
                type="button"
                onClick={() => setActiveFeatureId(feature.id)}
                className={`w-full text-left rounded-2xl border p-4 transition-colors ${
                  isActive
                    ? darkMode
                      ? "border-black/25 bg-black/10"
                      : "border-white/30 bg-white/10"
                    : darkMode
                      ? "border-black/10 bg-black/[0.02] hover:bg-black/5"
                      : "border-white/10 bg-white/[0.02] hover:bg-white/5"
                }`}
                aria-pressed={isActive}
              >
                <div
                  className={`text-[11px] font-medium tracking-[0.14em] ${
                    darkMode ? "text-black/60" : "text-white/60"
                  }`}
                >
                  {number}
                </div>
                <h3
                  className={`mt-2 text-base sm:text-lg font-semibold ${
                    darkMode ? "text-black" : "text-white"
                  }`}
                >
                  {feature.title}
                </h3>
                <p
                  className={`mt-2 text-sm leading-relaxed ${
                    darkMode ? "text-black/70" : "text-white/70"
                  }`}
                >
                  {feature.summary}
                </p>
              </button>
            );
          })}
        </div>

        <div className="overflow-hidden rounded-xl bg-white">
          <div className="relative w-full aspect-[16/10]">
            {merchantOsFeatures.map((feature) => {
              const isActive = feature.id === activeFeature.id;
              return (
                <motion.img
                  key={feature.id}
                  src={feature.screenshot}
                  alt={feature.alt}
                  className="absolute inset-0 h-full w-full object-cover"
                  initial={false}
                  animate={{ opacity: isActive ? 1 : 0 }}
                  transition={{ duration: 0.22, ease: "easeOut" }}
                  draggable={false}
                  aria-hidden={!isActive}
                  style={{ pointerEvents: isActive ? "auto" : "none" }}
                />
              );
            })}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl">
          <div className="relative w-full aspect-video">
            <iframe
              className="absolute inset-0 h-full w-full"
              src="https://www.youtube.com/embed/QzolAXE3xP8"
              title="RailBridge Merchant OS walkthrough"
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          </div>
        </div>
      </div>
    </Section>
  );
}

export function GetStartedSection({ darkMode }: { darkMode: boolean }) {
  return (
    <Section
      id="launch"
      title="Go Live In 3 Steps"
      subtitle="Start in testnet first, validate your merchant flow, then move to production with confidence."
      darkMode={darkMode}
    >
      <div className="grid md:grid-cols-3 gap-6">
        {[
          {
            step: "1",
            h: "Connect Merchant Flow",
            p: "Set up your paid endpoint and wire x402 payment middleware with RailBridge integration.",
          },
          {
            step: "2",
            h: "Run Testnet End To End",
            p: "Use app/api/facilitator/demo testnet stack and verify settlement timeline plus payouts.",
          },
          {
            step: "3",
            h: "Ship With Controls",
            p: "Use Merchant OS policies, API keys, and payout workflows as your team scales usage.",
          },
        ].map((item) => (
          <div
            key={item.step}
            className={`rounded-3xl border p-6 sm:p-7 shadow-sm transition-colors ${
              darkMode
                ? "border-white/15 bg-white/[0.02]"
                : "border-black/10 bg-black/[0.02]"
            }`}
          >
            <div
              className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                darkMode ? "bg-white/10 text-white" : "bg-black/5 text-black"
              }`}
            >
              {item.step}
            </div>
            <h3
              className={`mt-4 text-lg sm:text-xl font-semibold leading-snug ${
                darkMode ? "text-white" : "text-black"
              }`}
            >
              {item.h}
            </h3>
            <p
              className={`mt-3 text-sm leading-relaxed ${
                darkMode ? "text-white/70" : "text-black/70"
              }`}
            >
              {item.p}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-8 flex flex-wrap gap-3">
        <a
          href="https://railbridge.gitbook.io/docs"
          target="_blank"
          rel="noopener noreferrer"
          className={`px-4 py-2.5 font-medium transition-colors ${
            darkMode
              ? "bg-white hover:bg-white/90 text-black"
              : "bg-black hover:bg-black/90 text-white"
          }`}
        >
          Try Testnet Guide
        </a>
        <a
          href="mailto:railbridge.ai@proton.me"
          className={`px-4 py-2.5 border transition-colors ${
            darkMode
              ? "border-white/30 hover:bg-white/10"
              : "border-black/30 hover:bg-black/10"
          }`}
        >
          Book Integration Call
        </a>
      </div>
    </Section>
  );
}

export function FAQSection({ darkMode }: { darkMode: boolean }) {
  const [openFaq, setOpenFaq] = useState(0);

  return (
    <section id="faq" className="relative py-20 sm:py-28">
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid md:grid-cols-2 gap-10 md:gap-16 items-start">
          <div className="max-w-sm md:pr-4">
            <h2
              className={`text-2xl sm:text-3xl md:text-4xl font-semibold ${
                darkMode ? "text-white" : "text-black"
              }`}
            >
              Frequently Asked Questions
            </h2>
            <p
              className={`mt-3 text-sm ${
                darkMode ? "text-white/70" : "text-black/70"
              }`}
            >
              Everything you need to know about Merchant OS and RailBridge
              operations. Can&apos;t find an answer?{" "}
              <a
                href="mailto:railbridge.ai@proton.me"
                className="underline underline-offset-2"
              >
                Chat with our team
              </a>
              .
            </p>
          </div>

          <div
            className={`md:pl-4 border-t ${
              darkMode ? "border-white/10" : "border-black/10"
            }`}
          >
            {[
              {
                q: "What does Merchant OS handle for my business team?",
                a: "Merchant OS provides one control plane for products, balances, settlement timeline, payout operations, and API keys so teams do not have to operate chain-specific backoffice workflows.",
              },
              {
                q: "How does RailBridge fit with x402 payments?",
                a: "Payers complete x402 payments from supported networks while RailBridge coordinates routing and settlement lifecycle. Merchant OS then reflects outcomes in business-friendly views and operational APIs.",
              },
              {
                q: "Is this only for AI agents?",
                a: "No. Teams use RailBridge and Merchant OS for agent payments, API monetization, SaaS usage billing, marketplaces, and any product that needs stablecoin revenue with operational control.",
              },
              {
                q: "Can we start on testnet before production rollout?",
                a: "Yes. The stack supports dedicated testnet deployment with isolated configuration, domains, and data paths so teams can validate end-to-end flows safely.",
              },
            ].map((item, idx) => {
              const isOpen = openFaq === idx;

              return (
                <div
                  key={idx}
                  className={`transition-colors border-b ${
                    darkMode ? "border-white/10" : "border-black/10"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? -1 : idx)}
                    className="w-full px-0 md:px-4 py-4 flex items-center justify-between gap-4 text-left"
                  >
                    <span
                      className={`text-lg sm:text-lg font-medium ${
                        darkMode ? "text-white" : "text-black"
                      }`}
                    >
                      {item.q}
                    </span>
                    <span
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs transition-transform duration-200 ${
                        darkMode
                          ? "border-white/30 text-white/80"
                          : "border-black/20 text-black/70"
                      } ${isOpen ? "rotate-90" : ""}`}
                    >
                      {isOpen ? "−" : "+"}
                    </span>
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <div className="px-0 md:px-4 pb-4 pt-1 text-sm leading-relaxed overflow-hidden">
                        <motion.div
                          key="content"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.22, ease: "easeOut" }}
                        >
                          <p
                            className={
                              darkMode ? "text-white/70" : "text-black/70"
                            }
                          >
                            {item.a}
                          </p>
                        </motion.div>
                      </div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

export function CTASection({ darkMode }: { darkMode: boolean }) {
  const isCtaDark = !darkMode;

  return (
    <Section
      id="join"
      title="Run Your Payment Operations in Merchant OS"
      subtitle="Start with testnet, prove your flow, then scale with stronger controls."
      darkMode={darkMode}
      inverted
    >
      <div className="flex flex-wrap gap-3">
        <a
          href="https://railbridge.gitbook.io/docs"
          target="_blank"
          rel="noopener noreferrer"
          className={`px-4 py-2.5 font-medium transition-colors ${
            isCtaDark
              ? "bg-white hover:bg-white/90 text-black"
              : "bg-black hover:bg-black/90 text-white"
          }`}
        >
          View Integration Docs
        </a>
        <a
          href="mailto:railbridge.ai@proton.me"
          className={`px-4 py-2.5 border transition-colors ${
            isCtaDark
              ? "border-white/30 hover:bg-white/10 text-white"
              : "border-black/30 hover:bg-black/10"
          }`}
        >
          Contact Team
        </a>
      </div>
    </Section>
  );
}

export function FooterSection({ darkMode }: { darkMode: boolean }) {
  return (
    <footer
      className={`py-10 border-t text-center text-xs transition-colors ${
        darkMode
          ? "border-white/20 text-white/60" : "border-black/20 text-black/60"
      }`}
    >
      © {new Date().getFullYear()} RailBridge AI. Built for merchant-led
      onchain commerce.
    </footer>
  );
}
