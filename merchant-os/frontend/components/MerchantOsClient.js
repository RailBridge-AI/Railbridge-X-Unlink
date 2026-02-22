"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const AUTH_STORAGE_KEY = "merchant-os-demo-auth";
const THEME_STORAGE_KEY = "merchant-os-theme";

const SUCCESS_STATUSES = new Set(["bridge_confirmed", "confirmed", "completed", "settled_source"]);
const PENDING_STATUSES = new Set(["bridge_pending", "submitted", "requested"]);

const NETWORK_DISPLAY = {
  "eip155:42161": { name: "Arbitrum", logo: "arbitrum.svg" },
  "eip155:43114": { name: "Avalanche", logo: "avax.png" },
  "eip155:8453": { name: "Base", logo: "base.png" },
  "eip155:81224": { name: "Codex Mainnet", logo: null },
  "eip155:1": { name: "Ethereum", logo: "ethereum.svg" },
  "eip155:999": { name: "HyperEVM", logo: "hype.png" },
  "eip155:57073": { name: "Ink", logo: "ink.png" },
  "eip155:59144": { name: "Linea", logo: "Linea.png" },
  "eip155:143": { name: "Monad", logo: "monad.png" },
  "eip155:10": { name: "Optimism", logo: "optimism.svg" },
  "eip155:98866": { name: "Plume", logo: "plume.svg" },
  "eip155:137": { name: "Polygon", logo: "polygon.svg" },
  "eip155:1329": { name: "Sei", logo: "sei.png" },
  "eip155:146": { name: "Sonic", logo: "sonic.png" },
  "eip155:130": { name: "Unichain", logo: "unichain.svg" },
  "eip155:480": { name: "World Chain", logo: "worldcoin.svg" },
  "eip155:421614": { name: "Arbitrum Sepolia", logo: "arbitrum.svg" },
  "eip155:5042002": { name: "Arc Testnet", logo: "arc.jpg" },
  "eip155:43113": { name: "Avalanche Fuji", logo: "avax.png" },
  "eip155:84532": { name: "Base Sepolia", logo: "base.png" },
  "eip155:11155111": { name: "Ethereum Sepolia", logo: "ethereum.svg" },
  "eip155:998": { name: "HyperEVM Testnet", logo: "hype.png" },
  "eip155:763373": { name: "Ink Sepolia", logo: "ink.png" },
  "eip155:59141": { name: "Linea Sepolia", logo: "Linea.png" },
  "eip155:10143": { name: "Monad Testnet", logo: "monad.png" },
  "eip155:11155420": { name: "Optimism Sepolia", logo: "optimism.svg" },
  "eip155:98867": { name: "Plume Testnet", logo: "plume.svg" },
  "eip155:80002": { name: "Polygon Amoy", logo: "polygon.svg" },
  "eip155:1328": { name: "Sei Testnet", logo: "sei.png" },
  "eip155:14601": { name: "Sonic Testnet", logo: "sonic.png" },
  "eip155:1301": { name: "Unichain Sepolia", logo: "unichain.svg" },
  "eip155:4801": { name: "World Chain Sepolia", logo: "worldcoin.svg" }
};

const TOKEN_DISPLAY = {
  USDC: { symbol: "USDC", logo: "/token-logos/usdc.svg" }
};

const EXPLORER_TX_URL_BY_NETWORK = {
  "eip155:1": "https://etherscan.io/tx/{hash}",
  "eip155:10": "https://optimistic.etherscan.io/tx/{hash}",
  "eip155:137": "https://polygonscan.com/tx/{hash}",
  "eip155:42161": "https://arbiscan.io/tx/{hash}",
  "eip155:43114": "https://snowtrace.io/tx/{hash}",
  "eip155:8453": "https://basescan.org/tx/{hash}",
  "eip155:59144": "https://lineascan.build/tx/{hash}",
  "eip155:11155111": "https://sepolia.etherscan.io/tx/{hash}",
  "eip155:11155420": "https://sepolia-optimism.etherscan.io/tx/{hash}",
  "eip155:421614": "https://sepolia.arbiscan.io/tx/{hash}",
  "eip155:43113": "https://testnet.snowtrace.io/tx/{hash}",
  "eip155:5042002": "https://testnet.arcscan.app/tx/{hash}",
  "eip155:59141": "https://sepolia.lineascan.build/tx/{hash}",
  "eip155:80002": "https://amoy.polygonscan.com/tx/{hash}",
  "eip155:84532": "https://sepolia.basescan.org/tx/{hash}"
};

const TESTNET_CAIP2 = [
  "eip155:421614",
  "eip155:5042002",
  "eip155:43113",
  "eip155:84532",
  "eip155:11155111",
  "eip155:998",
  "eip155:763373",
  "eip155:59141",
  "eip155:10143",
  "eip155:11155420",
  "eip155:98867",
  "eip155:80002",
  "eip155:1328",
  "eip155:14601",
  "eip155:1301",
  "eip155:4801"
];

const INFO_SLIDES = [
  {
    title: "Merchant treasury infrastructure",
    subtitle:
      "Revenue from x402 flows is routed to custodial merchant wallets and surfaced in a single account view with chain-level transparency."
  },
  {
    title: "Cross-chain USDC in one place",
    subtitle:
      "Monitor balances per chain and consolidate to your preferred network with one click. USDC-only MVP, optimized for reliable demo flows."
  },
  {
    title: "No wallet setup required",
    subtitle: "Merchants use standard Web2 login. Custodial model with merchant-scoped isolation."
  }
];

const readAuthFromStorage = () => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && data.token && data.merchantId && data.accountId) {
      return data;
    }
  } catch {
    return null;
  }

  return null;
};

const saveAuthToStorage = (token, merchantId, accountId) => {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ token, merchantId, accountId }));
};

const clearAuthFromStorage = () => {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(AUTH_STORAGE_KEY);
};

const getNetworkInfo = (caip2) => {
  const info = NETWORK_DISPLAY[caip2];
  if (info) {
    return {
      name: info.name,
      logo: info.logo ? `/chain-logos/${info.logo}` : null
    };
  }
  return { name: caip2, logo: null };
};

const getTokenInfo = (asset) => {
  const normalizedAsset = String(asset || "USDC").toUpperCase();
  const token = TOKEN_DISPLAY[normalizedAsset];
  if (token) {
    return token;
  }
  return { symbol: normalizedAsset, logo: null };
};

const formatUsdcAmount = (baseUnits) => {
  const n = Number(baseUnits) / 1e6;
  return n.toFixed(n % 1 === 0 ? 0 : 3);
};

const formatDateTime = (value) => {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
};

const shortenHash = (value, left = 10, right = 8) => {
  if (!value || typeof value !== "string") {
    return "-";
  }
  if (value.length <= left + right + 3) {
    return value;
  }
  return `${value.slice(0, left)}...${value.slice(-right)}`;
};

const getExplorerTxUrl = (network, txHash) => {
  if (!network || !txHash || txHash === "-") {
    return null;
  }
  const template = EXPLORER_TX_URL_BY_NETWORK[network];
  if (!template) {
    return null;
  }
  return template.replace("{hash}", txHash);
};

const getDestinationLabel = (item) => {
  if (item.destinationNetwork) {
    return getNetworkInfo(item.destinationNetwork).name;
  }
  if (item.itemType === "settlement") {
    return "Same chain";
  }
  return "N/A";
};

const getApiDisplayName = (item) => {
  if (item.apiName) {
    return item.apiName;
  }
  if (item.apiRoute && item.apiRoute !== "Unknown API") {
    return item.apiRoute;
  }
  if (item.apiId && item.apiId !== "unknown") {
    return item.apiId;
  }
  return "Unattributed API";
};

const classNames = (...values) => values.filter(Boolean).join(" ");

const statusPillClass = (status) =>
  classNames(
    "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
    SUCCESS_STATUSES.has(status) &&
      "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-400/10 dark:text-emerald-300",
    PENDING_STATUSES.has(status) &&
      "border-cyan-300 bg-cyan-50 text-cyan-700 dark:border-cyan-500/30 dark:bg-cyan-400/10 dark:text-cyan-300",
    !SUCCESS_STATUSES.has(status) &&
      !PENDING_STATUSES.has(status) &&
      "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-400/10 dark:text-rose-300"
  );

const noticeClass = (mode) =>
  classNames(
    "rounded-xl border px-3 py-2 text-xs",
    mode === "ok" &&
      "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-400/10 dark:text-emerald-300",
    mode === "err" &&
      "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-400/10 dark:text-rose-300",
    mode !== "ok" &&
      mode !== "err" &&
      "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300"
  );

const NavIcon = ({ kind, active = false }) => {
  const iconClass = classNames("h-3.5 w-3.5", active ? "text-rail-700 dark:text-rail-200" : "text-slate-500 dark:text-slate-400");

  if (kind === "balances") {
    return (
      <svg className={iconClass} viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M4 14.5V9.5M8 14.5V6.5M12 14.5V11.5M16 14.5V8.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (kind === "history") {
    return (
      <svg className={iconClass} viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M7 6H16M7 10H16M7 14H16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="4" cy="6" r="1" fill="currentColor" />
        <circle cx="4" cy="10" r="1" fill="currentColor" />
        <circle cx="4" cy="14" r="1" fill="currentColor" />
      </svg>
    );
  }

  if (kind === "policy") {
    return (
      <svg className={iconClass} viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M4 6H16M4 10H16M4 14H16M8 6A1.5 1.5 0 1 0 8 6M12 10A1.5 1.5 0 1 0 12 10M6 14A1.5 1.5 0 1 0 6 14"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (kind === "apiRevenue") {
    return (
      <svg className={iconClass} viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M4 15.5V11.5M8 15.5V8.5M12 15.5V10.5M16 15.5V5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg className={iconClass} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M7 6H4.5A1.5 1.5 0 0 0 3 7.5V12.5A1.5 1.5 0 0 0 4.5 14H7M11 6L15 10M15 10L11 14M15 10H7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

const SidebarNavButton = ({ tab, label, activeTab, onClick }) => {
  const isActive = activeTab === tab;

  return (
    <button
      type="button"
      onClick={() => onClick(tab)}
      className={classNames(
        "flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-sm font-medium transition",
        isActive
          ? "border-slate-200 bg-white text-rail-800 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-rail-200"
          : "border-transparent bg-transparent text-slate-700 hover:border-slate-200 hover:bg-white/80 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-800/70"
      )}
    >
      <span
        className={classNames(
          "inline-flex h-6 w-6 items-center justify-center rounded-full border",
          isActive
            ? "border-rail-200 bg-rail-50 dark:border-rail-500/30 dark:bg-rail-400/10"
            : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
        )}
      >
        <NavIcon kind={tab} active={isActive} />
      </span>
      <span>{label}</span>
    </button>
  );
};

const ShimmerBlock = ({ className = "" }) => (
  <div className={classNames("rb-shimmer", className)} aria-hidden="true" />
);

const BalanceManagementSkeleton = () => (
  <div>
    <h2 className="text-xl font-semibold">Balance Management</h2>

    <section className="relative mt-3 overflow-hidden rounded-3xl bg-gradient-to-br from-rail-700 via-cyan-700 to-rail-600 p-5 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(-38deg,rgba(255,255,255,0.08)_0,rgba(255,255,255,0.08)_2px,transparent_2px,transparent_32px)]"></div>
      <div className="relative z-10 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <div className="text-sm text-cyan-50/95">Total Unified Balance</div>
          <ShimmerBlock className="mt-2 h-12 w-48 rounded-xl bg-white/25" />
          <ShimmerBlock className="mt-3 h-3 w-64 rounded bg-white/20" />
        </div>
        <div className="flex items-center gap-2">
          <ShimmerBlock className="h-9 w-24 rounded-xl bg-white/20" />
        </div>
      </div>
    </section>

    <section className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-800/65">
      <h3 className="text-base font-semibold">Per-Chain Balances</h3>
      <ul className="mt-2 grid max-h-[320px] gap-2 overflow-y-auto pr-1">
        {Array.from({ length: 6 }).map((_, index) => (
          <li
            key={`balance-skeleton-${index}`}
            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900"
          >
            <ShimmerBlock className="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
            <div className="min-w-0 flex-1">
              <ShimmerBlock className="h-3.5 w-24 rounded bg-slate-200 dark:bg-slate-700" />
              <ShimmerBlock className="mt-2 h-3 w-12 rounded bg-slate-200 dark:bg-slate-700" />
            </div>
            <div className="text-right">
              <ShimmerBlock className="h-3.5 w-16 rounded bg-slate-200 dark:bg-slate-700" />
              <ShimmerBlock className="mt-2 h-3 w-20 rounded bg-slate-200 dark:bg-slate-700" />
            </div>
          </li>
        ))}
      </ul>
    </section>

    <section className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-800/65">
      <h3 className="text-base font-semibold">Manual Consolidation</h3>
      <div className="mt-2 grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <ShimmerBlock className="h-14 rounded-xl bg-slate-200 dark:bg-slate-700" />
          <ShimmerBlock className="h-14 rounded-xl bg-slate-200 dark:bg-slate-700" />
        </div>
        <ShimmerBlock className="h-14 rounded-xl bg-slate-200 dark:bg-slate-700" />
        <ShimmerBlock className="h-10 w-44 rounded-xl bg-slate-200 dark:bg-slate-700" />
      </div>
    </section>
  </div>
);

const TransactionHistorySkeleton = () => (
  <div>
    <h2 className="text-xl font-semibold">Transaction History</h2>
    <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">
      All settlement and treasury events for this merchant account.
    </p>

    <ul className="mt-3 grid gap-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <li
          key={`history-skeleton-${index}`}
          className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/65"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ShimmerBlock className="h-5 w-28 rounded-full bg-slate-200 dark:bg-slate-700" />
            <ShimmerBlock className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-700" />
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-700 dark:bg-slate-900">
              <ShimmerBlock className="h-3 w-12 rounded bg-slate-200 dark:bg-slate-700" />
              <ShimmerBlock className="mt-2 h-3.5 w-20 rounded bg-slate-200 dark:bg-slate-700" />
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-700 dark:bg-slate-900">
              <ShimmerBlock className="h-3 w-14 rounded bg-slate-200 dark:bg-slate-700" />
              <ShimmerBlock className="mt-2 h-3.5 w-20 rounded bg-slate-200 dark:bg-slate-700" />
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-700 dark:bg-slate-900">
              <ShimmerBlock className="h-3 w-20 rounded bg-slate-200 dark:bg-slate-700" />
              <ShimmerBlock className="mt-2 h-3.5 w-20 rounded bg-slate-200 dark:bg-slate-700" />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <ShimmerBlock className="h-3 w-32 rounded bg-slate-200 dark:bg-slate-700" />
            <ShimmerBlock className="h-7 w-24 rounded-lg bg-slate-200 dark:bg-slate-700" />
          </div>
        </li>
      ))}
    </ul>
  </div>
);

const ApiRevenueSkeleton = () => (
  <div>
    <h2 className="text-xl font-semibold">API Revenue</h2>
    <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">
      Revenue split by x402 API endpoint for this merchant account.
    </p>

    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-800/65">
        <ShimmerBlock className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-700" />
        <ShimmerBlock className="mt-2 h-8 w-10 rounded bg-slate-200 dark:bg-slate-700" />
      </section>
      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-800/65">
        <ShimmerBlock className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-700" />
        <ShimmerBlock className="mt-2 h-8 w-24 rounded bg-slate-200 dark:bg-slate-700" />
        <ShimmerBlock className="mt-2 h-3 w-20 rounded bg-slate-200 dark:bg-slate-700" />
      </section>
    </div>

    <section className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-800/65">
      <h3 className="text-base font-semibold">Revenue By API</h3>
      <ul className="mt-2 grid gap-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <li
            key={`api-revenue-skeleton-${index}`}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <ShimmerBlock className="h-3.5 w-28 rounded bg-slate-200 dark:bg-slate-700" />
                <ShimmerBlock className="mt-2 h-3 w-36 rounded bg-slate-200 dark:bg-slate-700" />
              </div>
              <div className="text-right">
                <ShimmerBlock className="h-3.5 w-16 rounded bg-slate-200 dark:bg-slate-700" />
                <ShimmerBlock className="mt-2 h-3 w-14 rounded bg-slate-200 dark:bg-slate-700" />
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <ShimmerBlock className="h-3 w-20 rounded bg-slate-200 dark:bg-slate-700" />
              <ShimmerBlock className="h-3 w-32 rounded bg-slate-200 dark:bg-slate-700" />
            </div>
          </li>
        ))}
      </ul>
    </section>
  </div>
);

export default function MerchantOsClient({ page }) {
  const router = useRouter();

  const [hydrated, setHydrated] = useState(false);
  const [theme, setTheme] = useState("light");
  const [token, setToken] = useState(null);
  const [merchantId, setMerchantId] = useState(null);
  const [accountId, setAccountId] = useState(null);
  const [overview, setOverview] = useState(null);
  const [settlements, setSettlements] = useState(null);
  const [apiRevenue, setApiRevenue] = useState(null);
  const [activeTab, setActiveTab] = useState("balances");

  const [email, setEmail] = useState("ops+alpha@railbridge.demo");
  const [password, setPassword] = useState("demo123");

  const [sourceNetworks, setSourceNetworks] = useState([]);
  const [destinationNetwork, setDestinationNetwork] = useState("");
  const [preferredNetwork, setPreferredNetwork] = useState("");
  const [autoBridgeEnabled, setAutoBridgeEnabled] = useState(true);
  const [consolidationAmount, setConsolidationAmount] = useState("0.10");

  const [sessionMessage, setSessionMessage] = useState("");
  const [sessionMessageMode, setSessionMessageMode] = useState("muted");
  const [loading, setLoading] = useState(false);
  const [isInitialDashboardLoading, setIsInitialDashboardLoading] = useState(false);
  const [infoSlide, setInfoSlide] = useState(0);

  const isLoggedIn = Boolean(token && merchantId && accountId);
  const networks = useMemo(() => {
    const rows = overview?.custody?.wallets || [];
    return Array.from(new Set(rows.map((row) => row.network)));
  }, [overview]);
  const timeline = settlements?.timeline || [];
  const balances = overview?.balances || [];
  const apiRevenueItems = apiRevenue?.apis || [];
  const apiRevenueTotals = apiRevenue?.totals || { apiCount: 0, totalUsd: "0.00", totalAmount: "0" };

  const balanceByNetwork = useMemo(() => {
    const map = {};
    balances.forEach((balance) => {
      map[balance.network] = balance;
    });
    return map;
  }, [balances]);

  const sortedBalanceNetworks = useMemo(() => {
    const allNetworks = new Set([...TESTNET_CAIP2, ...Object.keys(balanceByNetwork)]);
    return Array.from(allNetworks).sort(
      (a, b) => Number(balanceByNetwork[b]?.usdValue ?? 0) - Number(balanceByNetwork[a]?.usdValue ?? 0)
    );
  }, [balanceByNetwork]);

  const consolidationNetworkOptions = useMemo(
    () =>
      [...networks].sort(
        (a, b) => Number(balanceByNetwork[b]?.usdValue ?? 0) - Number(balanceByNetwork[a]?.usdValue ?? 0)
      ),
    [networks, balanceByNetwork]
  );

  const validConsolidationSources = useMemo(
    () =>
      sourceNetworks
        .filter((network, index, arr) => network && arr.indexOf(network) === index)
        .filter((network) => networks.includes(network) && network !== destinationNetwork),
    [sourceNetworks, networks, destinationNetwork]
  );

  useEffect(() => {
    const storedAuth = readAuthFromStorage();
    if (storedAuth) {
      setToken(storedAuth.token);
      setMerchantId(storedAuth.merchantId);
      setAccountId(storedAuth.accountId);
    }

    if (typeof window !== "undefined") {
      const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (storedTheme === "light" || storedTheme === "dark") {
        setTheme(storedTheme);
      }
    }

    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    document.documentElement.classList.toggle("dark", theme === "dark");
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  }, [theme, hydrated]);

  useEffect(() => {
    if (!hydrated) return;

    if (page === "dashboard" && !isLoggedIn) {
      router.replace("/");
      return;
    }

    if (page === "login" && isLoggedIn) {
      router.replace("/dashboard");
    }
  }, [page, hydrated, isLoggedIn, router]);

  useEffect(() => {
    if (!overview) {
      setPreferredNetwork("");
      setSourceNetworks([]);
      setDestinationNetwork("");
      setAutoBridgeEnabled(true);
      return;
    }

    const preferred = overview?.policy?.preferredNetwork;
    const fallback = networks[0] || "";
    const preferredOrFallback = preferred && networks.includes(preferred) ? preferred : fallback;

    setPreferredNetwork((curr) => (curr && networks.includes(curr) ? curr : preferredOrFallback));
    setDestinationNetwork((curr) => (curr && networks.includes(curr) ? curr : preferredOrFallback));
    setSourceNetworks((curr) => {
      const valid = (curr || []).filter((network) => networks.includes(network));
      if (valid.length) {
        return valid;
      }
      return fallback ? [fallback] : [];
    });
    setAutoBridgeEnabled(Boolean(overview?.policy?.autoBridgeEnabled));
  }, [overview, networks]);

  useEffect(() => {
    if (!destinationNetwork) return;
    setSourceNetworks((curr) => curr.filter((network) => network !== destinationNetwork));
  }, [destinationNetwork]);

  const setNotice = (message, mode = "muted") => {
    setSessionMessage(message);
    setSessionMessageMode(mode);
  };

  const authHeaders = useCallback(() => (token ? { authorization: `Bearer ${token}` } : {}), [token]);

  const api = useCallback(
    async (path, options = {}) => {
      const response = await fetch(path, {
        ...options,
        headers: {
          "content-type": "application/json",
          ...(options.headers || {}),
          ...authHeaders()
        }
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      return body;
    },
    [authHeaders]
  );

  const refreshDashboard = useCallback(async () => {
    if (!token || !merchantId || !accountId) return;

    const [nextOverview, nextSettlements, nextApiRevenue] = await Promise.all([
      api(`/v1/demo/merchant/${merchantId}/accounts/${accountId}/overview`, { method: "GET" }),
      api(`/v1/demo/merchant/${merchantId}/accounts/${accountId}/settlements`, { method: "GET" }),
      api(`/v1/demo/merchant/${merchantId}/accounts/${accountId}/api-revenue`, { method: "GET" })
    ]);

    setOverview(nextOverview);
    setSettlements(nextSettlements);
    setApiRevenue(nextApiRevenue);
  }, [api, token, merchantId, accountId]);

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoading(true);
    try {
      const data = await api("/v1/demo/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password })
      });

      setToken(data.token);
      setMerchantId(data.merchantId);
      setAccountId(data.accountId);
      saveAuthToStorage(data.token, data.merchantId, data.accountId);
      setActiveTab("balances");
      setNotice(`Logged in as ${data.user.email} | merchant=${data.merchantId} | account=${data.accountId}`, "ok");
      router.push("/dashboard");
    } catch (error) {
      setNotice(error.message || "Login failed", "err");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    setToken(null);
    setMerchantId(null);
    setAccountId(null);
    setOverview(null);
    setSettlements(null);
    setApiRevenue(null);
    setIsInitialDashboardLoading(false);
    setActiveTab("balances");
    clearAuthFromStorage();
    setSessionMessage("");
    router.replace("/");
  };

  const handleRefresh = async () => {
    if (!isLoggedIn) return;
    setLoading(true);
    try {
      await refreshDashboard();
      setNotice("Dashboard refreshed", "ok");
    } catch (error) {
      setNotice(error.message || "Refresh failed", "err");
    } finally {
      setLoading(false);
    }
  };

  const handleSavePolicy = async () => {
    if (!isLoggedIn) return;
    setLoading(true);
    try {
      await api(`/v1/demo/merchant/${merchantId}/accounts/${accountId}/policy`, {
        method: "PUT",
        body: JSON.stringify({
          preferredNetwork,
          autoBridgeEnabled,
          preferredAsset: "USDC"
        })
      });
      await refreshDashboard();
      setNotice("Policy updated", "ok");
    } catch (error) {
      setNotice(error.message || "Policy update failed", "err");
    } finally {
      setLoading(false);
    }
  };

  const toggleSourceNetwork = (network) => {
    setSourceNetworks((curr) =>
      curr.includes(network) ? curr.filter((value) => value !== network) : [...curr, network]
    );
  };

  const handleConsolidation = async () => {
    if (!isLoggedIn) return;
    const selectedSourceNetworks = sourceNetworks
      .map((network) => String(network || "").trim())
      .filter((network, index, arr) => network && arr.indexOf(network) === index)
      .filter((network) => network !== destinationNetwork);

    if (!destinationNetwork || !selectedSourceNetworks.length) {
      setNotice("Select at least one source network and a destination network", "err");
      return;
    }

    setLoading(true);
    try {
      const results = await Promise.allSettled(
        selectedSourceNetworks.map((sourceNetwork) =>
          api(`/v1/demo/merchant/${merchantId}/accounts/${accountId}/consolidations`, {
            method: "POST",
            body: JSON.stringify({
              sourceNetwork,
              destinationNetwork,
              asset: "USDC",
              amountUsdc: consolidationAmount.trim()
            })
          })
        )
      );

      const succeeded = results.filter((result) => result.status === "fulfilled").length;
      const failedResults = results.filter((result) => result.status === "rejected");
      await refreshDashboard();
      if (!failedResults.length) {
        setNotice(
          `Consolidation submitted for ${succeeded} source network${succeeded === 1 ? "" : "s"}`,
          "ok"
        );
      } else {
        const firstError = failedResults[0]?.reason;
        const firstMessage =
          firstError instanceof Error ? firstError.message : String(firstError || "unknown error");
        setNotice(
          `Submitted ${succeeded}/${selectedSourceNetworks.length} consolidations. First failure: ${firstMessage}`,
          succeeded > 0 ? "muted" : "err"
        );
      }
    } catch (error) {
      setNotice(error.message || "Consolidation failed", "err");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    setIsInitialDashboardLoading(true);

    refreshDashboard()
      .catch((error) => {
        setNotice(error.message || "Unable to load dashboard", "err");
      })
      .finally(() => {
        if (!cancelled) {
          setIsInitialDashboardLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, refreshDashboard]);

  if (!hydrated) {
    return <div className="flex min-h-screen items-center justify-center text-slate-500 dark:text-slate-400">Loading...</div>;
  }

  if (page === "dashboard" && !isLoggedIn) {
    return <div className="flex min-h-screen items-center justify-center text-slate-500 dark:text-slate-400">Redirecting...</div>;
  }

  if (page === "login" && isLoggedIn) {
    return <div className="flex min-h-screen items-center justify-center text-slate-500 dark:text-slate-400">Redirecting...</div>;
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-slate-50/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/85">
        <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <img src="/RailBridge-Logo.png" alt="RailBridge" className="h-10 w-10 rounded-sm object-contain" draggable={false} />
            <span className="text-[15px] font-semibold tracking-tight">RailBridge Merchant OS</span>
            <span className="hidden text-xs text-slate-500 dark:text-slate-400 sm:inline">Custodial USDC Treasury</span>
          </div>
          <button
            type="button"
            className={classNames(
              "relative inline-flex h-7 w-14 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-slate-900",
              theme === "dark" ? "bg-gray-800 focus:ring-white/50" : "bg-gray-200 focus:ring-black/50"
            )}
            onClick={() => setTheme((curr) => (curr === "light" ? "dark" : "light"))}
            aria-label="Toggle dark mode"
            role="switch"
            aria-checked={theme === "dark"}
          >
            <svg
              className={classNames("absolute left-1.5 h-4 w-4 transition-opacity", theme === "dark" ? "opacity-100 text-white" : "opacity-0")}
              fill="currentColor"
              viewBox="0 0 20 20"
              aria-hidden="true"
            >
              <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
            </svg>
            <svg
              className={classNames(
                "absolute right-1.5 h-4 w-4 transition-opacity",
                theme === "dark" ? "opacity-0" : "opacity-100 text-gray-800"
              )}
              fill="currentColor"
              viewBox="0 0 20 20"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
                clipRule="evenodd"
              />
            </svg>
            <span
              className={classNames(
                "inline-block h-5 w-5 rounded-full bg-white shadow-md transition-transform",
                theme === "dark" ? "translate-x-8" : "translate-x-1"
              )}
            ></span>
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1280px] px-6 pb-8 pt-8">
        {page === "login" ? (
          <section className="grid min-h-[calc(100vh-8rem)] grid-cols-1 lg:grid-cols-2">
            <div
              className={classNames(
                "relative overflow-hidden border-r border-slate-200 px-6 py-10 dark:border-slate-800 lg:px-10 lg:py-12",
                theme === "dark" ? "bg-black" : "bg-white dark:bg-black"
              )}
            >
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <span className={classNames("absolute left-[10%] top-[15%] h-20 w-20 rounded-full blur-xl", theme === "dark" ? "bg-white/10" : "bg-black/5")}></span>
                <span className={classNames("absolute right-[20%] top-[30%] h-16 w-16 rounded-full blur-xl", theme === "dark" ? "bg-white/5" : "bg-slate-400/10")}></span>
                <span className={classNames("absolute bottom-[25%] left-[25%] h-12 w-12 rounded-full blur-xl", theme === "dark" ? "bg-white/10" : "bg-black/5")}></span>
                <span className={classNames("absolute right-[15%] bottom-[20%] h-14 w-14 rounded-full blur-xl", theme === "dark" ? "bg-white/5" : "bg-slate-400/10")}></span>
              </div>

              <div className="relative z-10 flex h-full flex-col justify-end">
                <div className="mt-auto">
                  <h2 className={classNames("text-2xl font-semibold leading-tight sm:text-3xl", theme === "dark" ? "text-white" : "text-slate-900 dark:text-white")}>
                    {INFO_SLIDES[infoSlide].title}
                  </h2>
                  <p className={classNames("mt-3 max-w-lg text-sm leading-relaxed", theme === "dark" ? "text-white/80" : "text-slate-600 dark:text-white/80")}>
                    {INFO_SLIDES[infoSlide].subtitle}
                  </p>
                  <div className="mt-6 flex gap-2">
                    {INFO_SLIDES.map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        aria-label={`Slide ${i + 1}`}
                        onClick={() => setInfoSlide(i)}
                        className={classNames(
                          "h-2 w-2 rounded-full transition",
                          theme === "dark"
                            ? i === infoSlide
                              ? "scale-110 bg-white"
                              : "bg-white/40 hover:bg-white/60"
                            : i === infoSlide
                              ? "scale-110 bg-slate-900 dark:bg-white"
                              : "bg-slate-300 hover:bg-slate-400 dark:bg-white/40 dark:hover:bg-white/60"
                        )}
                      ></button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-center justify-center bg-white px-6 py-10 dark:bg-slate-900 lg:px-12 lg:py-12">
              <div className="w-full max-w-sm">
                <img src="/RailBridge-Logo.png" alt="" className="mx-auto h-12 w-12 rounded-lg object-contain" />
                <h2 className="mt-6 text-center text-2xl font-semibold tracking-tight text-slate-900 dark:text-white sm:text-3xl">Hello again</h2>
                <p className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
                  Sign in to your Merchant OS account to manage your treasury and cross-chain USDC.
                </p>

                <form className="mt-6 flex flex-col gap-4" onSubmit={handleLogin}>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Email
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-rail-500 focus:ring-2 focus:ring-rail-200 dark:border-slate-600 dark:bg-slate-900 dark:focus:ring-rail-800"
                    />
                  </label>

                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Password
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-rail-500 focus:ring-2 focus:ring-rail-200 dark:border-slate-600 dark:bg-slate-900 dark:focus:ring-rail-800"
                    />
                  </label>

                  <button
                    type="submit"
                    disabled={loading}
                    className="rounded-xl border border-rail-700 bg-gradient-to-br from-rail-700 to-rail-800 px-4 py-3 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-65"
                  >
                    {loading ? "Signing in..." : "Login"}
                  </button>
                </form>

                {sessionMessage ? <div className={classNames("mt-4 text-center text-sm", noticeClass(sessionMessageMode))}>{sessionMessage}</div> : null}
              </div>
            </div>
          </section>
        ) : (
          <section className="grid min-h-[650px] gap-4 lg:grid-cols-[290px_1fr]">
            <aside className="rounded-[26px] border border-slate-200 bg-slate-100 p-4 shadow-panel dark:border-slate-800 dark:bg-slate-900/70">
              <div className="rounded-2xl border border-slate-200 bg-white px-3.5 py-3 dark:border-slate-700 dark:bg-slate-900">
                <div className="flex items-center gap-2.5">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-rail-500 to-rail-700 text-xs font-bold uppercase text-white">
                    RB
                  </span>
                  <div>
                    <div className="text-lg font-semibold leading-none tracking-tight">RailBridge</div>
                    <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Merchant OS</div>
                  </div>
                </div>
              </div>

              <div className="my-4 h-px bg-slate-200 dark:bg-slate-700"></div>

              <div className="px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">General</div>
              <div className="mt-2 grid gap-1.5">
                <SidebarNavButton tab="balances" label="Balance Management" activeTab={activeTab} onClick={setActiveTab} />
                <SidebarNavButton tab="history" label="Transaction History" activeTab={activeTab} onClick={setActiveTab} />
                <SidebarNavButton tab="apiRevenue" label="API Revenue" activeTab={activeTab} onClick={setActiveTab} />
                <SidebarNavButton tab="policy" label="Policy Setup" activeTab={activeTab} onClick={setActiveTab} />
              </div>

              <div className="mt-auto pt-4">
                <div className="px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Settings</div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="mt-2 flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                    <NavIcon kind="logout" />
                  </span>
                  <span>Logout</span>
                </button>
              </div>
            </aside>

            <section className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-panel dark:border-slate-800 dark:bg-slate-900/80">
              {activeTab === "balances" ? (
                isInitialDashboardLoading && !overview ? (
                  <BalanceManagementSkeleton />
                ) : (
                  <div>
                    <h2 className="text-xl font-semibold">Balance Management</h2>

                    <section className="relative mt-3 overflow-hidden rounded-3xl bg-gradient-to-br from-rail-700 via-cyan-700 to-rail-600 p-5 text-white">
                      <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(-38deg,rgba(255,255,255,0.08)_0,rgba(255,255,255,0.08)_2px,transparent_2px,transparent_32px)]"></div>
                      <div className="relative z-10 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                        <div>
                          <div className="text-sm text-cyan-50/95">Total Unified Balance</div>
                          <div className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">${overview?.unifiedUsd || "0.00"}</div>
                          <div className="mt-2 text-sm text-cyan-100/90">USDC value across all tracked networks</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handleRefresh}
                            disabled={loading}
                            className="rounded-xl border border-white/40 bg-white/15 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-65"
                          >
                            {loading ? "Refreshing..." : "Refresh"}
                          </button>
                        </div>
                      </div>
                    </section>

                    <section className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-800/65">
                      <h3 className="text-base font-semibold">Per-Chain Balances</h3>
                      <ul className="mt-2 grid max-h-[320px] gap-2 overflow-y-auto pr-1">
                        {sortedBalanceNetworks.map((network) => {
                          const balance = balanceByNetwork[network];
                          const net = getNetworkInfo(network);
                          const amount = balance ? balance.amount : "0";
                          const usdValue = balance ? (balance.usdValue ?? "0.00") : "0.00";
                          const usdcFormatted = formatUsdcAmount(amount);
                          const asset = balance ? balance.asset : "USDC";

                          return (
                            <li
                              key={network}
                              className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900"
                            >
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                {net.logo ? (
                                  <img src={net.logo} alt="" className="h-8 w-8 object-contain" />
                                ) : (
                                  <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">{net.name.charAt(0)}</span>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold text-slate-900 dark:text-white">{net.name}</div>
                                <div className="mt-0.5 text-xs text-emerald-600 dark:text-emerald-400">{asset}</div>
                              </div>
                              <div className="text-right">
                                <div className="text-sm font-semibold text-slate-900 dark:text-white">${usdValue}</div>
                                <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{usdcFormatted} USDC</div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </section>

                    <section className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-800/65">
                      <h3 className="text-base font-semibold">Manual Consolidation</h3>
                      <div className="mt-2 grid gap-3">
                        <div className="hidden items-center gap-2 text-xs text-slate-500 dark:text-slate-400 sm:flex">
                          <span className="font-medium">Source Networks</span>
                          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                            <path d="M4 10H16M16 10L12 6M16 10L12 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          <span className="font-medium">Destination Network</span>
                        </div>

                        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)]">
                          <div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              Source Networks (multi-select) | {validConsolidationSources.length} selected
                            </div>
                            <div className="mt-1.5 grid max-h-[260px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                              {consolidationNetworkOptions.length ? (
                                consolidationNetworkOptions.map((network) => {
                                  const net = getNetworkInfo(network);
                                  const balance = balanceByNetwork[network];
                                  const isSelected = sourceNetworks.includes(network);
                                  const isDestination = network === destinationNetwork;
                                  const usdValue = balance ? balance.usdValue ?? "0.00" : "0.00";
                                  const usdcValue = formatUsdcAmount(balance ? balance.amount : "0");
                                  const token = getTokenInfo(balance ? balance.asset : "USDC");
                                  return (
                                    <button
                                      key={`source-${network}`}
                                      type="button"
                                      disabled={isDestination}
                                      onClick={() => toggleSourceNetwork(network)}
                                      className={classNames(
                                        "flex items-center gap-3 rounded-xl border bg-white px-3 py-2 text-left transition dark:bg-slate-900",
                                        isSelected
                                          ? "border-rail-500 ring-1 ring-rail-200 dark:border-rail-400 dark:ring-rail-700/50"
                                          : "border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600",
                                        isDestination && "cursor-not-allowed opacity-50"
                                      )}
                                    >
                                      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                        {net.logo ? (
                                          <img src={net.logo} alt="" className="h-7 w-7 object-contain" />
                                        ) : (
                                          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                                            {net.name.charAt(0)}
                                          </span>
                                        )}
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{net.name}</div>
                                        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                                          {token.logo ? (
                                            <img src={token.logo} alt={token.symbol} className="h-3.5 w-3.5 rounded-full object-contain" />
                                          ) : (
                                            <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-slate-300 text-[9px] dark:border-slate-600">
                                              $
                                            </span>
                                          )}
                                          <span>{token.symbol}</span>
                                        </div>
                                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                          ${usdValue} | {usdcValue} USDC
                                        </div>
                                      </div>
                                      <span
                                        className={classNames(
                                          "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
                                          isSelected
                                            ? "border-rail-500 bg-rail-500 text-white"
                                            : "border-slate-300 text-slate-400 dark:border-slate-600 dark:text-slate-500"
                                        )}
                                      >
                                        {isSelected ? "✓" : ""}
                                      </span>
                                    </button>
                                  );
                                })
                              ) : (
                                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                                  No networks
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="hidden lg:flex items-center justify-center">
                            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-500 shadow-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300">
                              <svg className="h-6 w-6" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                                <path
                                  d="M3.5 10H16.5M16.5 10L12 5.5M16.5 10L12 14.5"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </div>
                          </div>

                          <div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">Destination Network (single-select)</div>
                            <div className="mt-1.5 grid max-h-[260px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                              {consolidationNetworkOptions.length ? (
                                consolidationNetworkOptions.map((network) => {
                                  const net = getNetworkInfo(network);
                                  const isSelected = destinationNetwork === network;
                                  const token = getTokenInfo("USDC");
                                  return (
                                    <button
                                      key={`destination-${network}`}
                                      type="button"
                                      onClick={() => setDestinationNetwork(network)}
                                      className={classNames(
                                        "flex items-center gap-3 rounded-xl border bg-white px-3 py-2 text-left transition dark:bg-slate-900",
                                        isSelected
                                          ? "border-rail-500 ring-1 ring-rail-200 dark:border-rail-400 dark:ring-rail-700/50"
                                          : "border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600"
                                      )}
                                    >
                                      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                        {net.logo ? (
                                          <img src={net.logo} alt="" className="h-7 w-7 object-contain" />
                                        ) : (
                                          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                                            {net.name.charAt(0)}
                                          </span>
                                        )}
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{net.name}</div>
                                        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                                          {token.logo ? (
                                            <img src={token.logo} alt={token.symbol} className="h-3.5 w-3.5 rounded-full object-contain" />
                                          ) : (
                                            <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-slate-300 text-[9px] dark:border-slate-600">
                                              $
                                            </span>
                                          )}
                                          <span>{token.symbol}</span>
                                        </div>
                                      </div>
                                      <span
                                        className={classNames(
                                          "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
                                          isSelected
                                            ? "border-rail-500 bg-rail-500 text-white"
                                            : "border-slate-300 text-slate-400 dark:border-slate-600 dark:text-slate-500"
                                        )}
                                      >
                                        {isSelected ? "✓" : ""}
                                      </span>
                                    </button>
                                  );
                                })
                              ) : (
                                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                                  No networks
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        <label className="block text-xs text-slate-500 dark:text-slate-400">
                          Amount per Source (USDC)
                          <input
                            value={consolidationAmount}
                            onChange={(event) => setConsolidationAmount(event.target.value)}
                            placeholder="0.10"
                            className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-rail-500 focus:ring-2 focus:ring-rail-200 dark:border-slate-600 dark:bg-slate-900 dark:focus:ring-rail-800"
                          />
                          <span className="mt-1 block text-[11px] text-slate-400 dark:text-slate-500">
                            Enter decimal USDC (up to 6 decimals), e.g. 0.10
                          </span>
                        </label>

                        <button
                          type="button"
                          onClick={handleConsolidation}
                          disabled={loading || !destinationNetwork || !validConsolidationSources.length}
                          className="rounded-xl border border-rail-700 bg-gradient-to-br from-rail-700 to-rail-800 px-3 py-2.5 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-65"
                        >
                          {loading
                            ? "Submitting..."
                            : validConsolidationSources.length
                              ? `Consolidate ${validConsolidationSources.length} Source${validConsolidationSources.length === 1 ? "" : "s"}`
                              : "Consolidate Sources"}
                        </button>
                      </div>
                    </section>
                  </div>
                )
              ) : null}

              {activeTab === "history" ? (
                isInitialDashboardLoading && !settlements ? (
                  <TransactionHistorySkeleton />
                ) : (
                  <div>
                    <h2 className="text-xl font-semibold">Transaction History</h2>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">
                      All settlement and treasury events for this merchant account.
                    </p>
                    <ul className="mt-3 grid gap-2">
                      {timeline.length === 0 ? (
                        <li className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                          No events yet.
                        </li>
                      ) : (
                        timeline.map((item, index) => {
                          const txNetwork =
                            item.status === "bridge_confirmed" && item.destinationNetwork
                              ? item.destinationNetwork
                              : item.sourceNetwork;
                          const txUrl = getExplorerTxUrl(txNetwork, item.txHash);
                          const sourceLabel = item.sourceNetwork ? getNetworkInfo(item.sourceNetwork).name : "-";
                          const destinationLabel = getDestinationLabel(item);
                          return (
                            <li
                              key={`${item.id}-${index}`}
                              className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/65"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={statusPillClass(item.status)}>{item.status}</span>
                                  <span className="text-sm font-semibold capitalize">{item.itemType}</span>
                                </div>
                                <span className="text-xs text-slate-500 dark:text-slate-400">{formatDateTime(item.createdAt)}</span>
                              </div>

                              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                                <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-700 dark:bg-slate-900">
                                  <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Amount</div>
                                  <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                                    {formatUsdcAmount(item.amount || "0")} USDC
                                  </div>
                                </div>
                                <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-700 dark:bg-slate-900">
                                  <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Source</div>
                                  <div className="mt-1 text-sm font-medium text-slate-900 dark:text-white">{sourceLabel}</div>
                                </div>
                                <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-700 dark:bg-slate-900">
                                  <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Destination</div>
                                  <div className="mt-1 text-sm font-medium text-slate-900 dark:text-white">{destinationLabel}</div>
                                </div>
                              </div>

                              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                                <div className="font-mono text-xs text-slate-600 dark:text-slate-300">
                                  tx: {shortenHash(item.txHash || "-")}
                                </div>
                                {txUrl ? (
                                  <a
                                    href={txUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                                  >
                                    View on Scanner
                                  </a>
                                ) : (
                                  <span className="text-[11px] text-slate-500 dark:text-slate-400">No scanner link</span>
                                )}
                              </div>

                              <div className="mt-2 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                event: {item.id}
                              </div>
                            </li>
                          );
                        })
                      )}
                    </ul>
                  </div>
                )
              ) : null}

              {activeTab === "apiRevenue" ? (
                isInitialDashboardLoading && !apiRevenue ? (
                  <ApiRevenueSkeleton />
                ) : (
                  <div>
                    <h2 className="text-xl font-semibold">API Revenue</h2>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">
                      Revenue split by x402 API endpoint for this merchant account.
                    </p>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-800/65">
                        <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Tracked APIs</div>
                        <div className="mt-1 text-3xl font-semibold">{apiRevenueTotals.apiCount}</div>
                      </section>
                      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-800/65">
                        <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Total Revenue</div>
                        <div className="mt-1 text-3xl font-semibold">${apiRevenueTotals.totalUsd || "0.00"}</div>
                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {formatUsdcAmount(apiRevenueTotals.totalAmount || "0")} USDC
                        </div>
                      </section>
                    </div>

                    <section className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-800/65">
                      <h3 className="text-base font-semibold">Revenue By API</h3>
                      <ul className="mt-2 grid gap-2">
                        {apiRevenueItems.length === 0 ? (
                          <li className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                            No API revenue events yet.
                          </li>
                        ) : (
                          apiRevenueItems.map((item) => (
                            <li
                              key={`${item.apiId}-${item.apiRoute}`}
                              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                                    {getApiDisplayName(item)}
                                  </div>
                                  <div className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">
                                    {item.apiRoute || "-"}
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="text-sm font-semibold text-slate-900 dark:text-white">${item.totalUsd}</div>
                                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                    {formatUsdcAmount(item.totalAmount)} USDC
                                  </div>
                                </div>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                                <span>Settlements: {item.settlementsCount}</span>
                                <span>Last payment: {formatDateTime(item.latestAt)}</span>
                              </div>
                            </li>
                          ))
                        )}
                      </ul>
                    </section>
                  </div>
                )
              ) : null}

              {activeTab === "policy" ? (
                <div>
                  <h2 className="text-xl font-semibold">Policy Setup</h2>
                  <section className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-800/65">
                    <div className="grid gap-3">
                      <label className="block text-xs text-slate-500 dark:text-slate-400">
                        Preferred Network
                        <select
                          value={preferredNetwork}
                          onChange={(event) => setPreferredNetwork(event.target.value)}
                          className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-rail-500 focus:ring-2 focus:ring-rail-200 dark:border-slate-600 dark:bg-slate-900 dark:focus:ring-rail-800"
                        >
                          {networks.length ? (
                            networks.map((network) => (
                              <option key={network} value={network}>
                                {getNetworkInfo(network).name}
                              </option>
                            ))
                          ) : (
                            <option value="">No networks</option>
                          )}
                        </select>
                      </label>

                      <label className="block text-xs text-slate-500 dark:text-slate-400">
                        Auto Bridge Enabled
                        <select
                          value={autoBridgeEnabled ? "true" : "false"}
                          onChange={(event) => setAutoBridgeEnabled(event.target.value === "true")}
                          className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-rail-500 focus:ring-2 focus:ring-rail-200 dark:border-slate-600 dark:bg-slate-900 dark:focus:ring-rail-800"
                        >
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      </label>

                      <button
                        type="button"
                        onClick={handleSavePolicy}
                        disabled={loading || !preferredNetwork}
                        className="rounded-xl border border-rail-700 bg-gradient-to-br from-rail-700 to-rail-800 px-3 py-2.5 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-65"
                      >
                        {loading ? "Saving..." : "Save Policy"}
                      </button>
                    </div>
                  </section>
                </div>
              ) : null}

              {sessionMessage ? <div className={classNames("mt-4", noticeClass(sessionMessageMode))}>{sessionMessage}</div> : null}
            </section>
          </section>
        )}
      </main>
    </div>
  );
}
