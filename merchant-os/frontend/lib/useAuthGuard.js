"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearAuth, readAuth } from "./platformClient";

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
