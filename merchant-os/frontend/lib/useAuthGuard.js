"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearAuth, readAuth, saveAuth } from "./platformClient";

export const useAuthGuard = () => {
  const router = useRouter();
  const [auth, setAuth] = useState(null);

  useEffect(() => {
    const stored = readAuth();
    if (!stored) {
      router.replace("/");
      return;
    }
    setAuth(stored);

    const hasProfile =
      Boolean(String(stored.merchantName || "").trim()) &&
      Boolean(String(stored.accountName || "").trim()) &&
      Boolean(String(stored.user?.email || "").trim());

    if (hasProfile || !stored.token) {
      return;
    }

    fetch("/v1/onboarding/settings", {
      method: "GET",
      headers: {
        authorization: `Bearer ${stored.token}`
      }
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
        }
        const merged = {
          ...stored,
          merchantName: payload.merchantName || stored.merchantName || "",
          accountName: payload.accountName || stored.accountName || "",
          user: payload.user || stored.user || null
        };
        saveAuth(merged);
        setAuth(merged);
      })
      .catch(() => {
        // Keep existing auth; user can continue with fallback UI labels.
      });
  }, [router]);

  const logout = () => {
    clearAuth();
    router.replace("/");
  };

  return {
    auth,
    logout,
    setAuth
  };
};
