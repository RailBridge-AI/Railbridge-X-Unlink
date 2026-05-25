"use client";

import { useEffect, useState } from "react";
import {
  HeaderSection,
  HeroSection,
  ProblemSection,
  SolutionSection,
  AudienceSection,
  MerchantOsSection,
  FAQSection,
  CTASection,
  FooterSection,
} from "./components/landingSections";

export default function Page() {
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    if (darkMode) {
      document.body.classList.remove("bg-white");
      document.body.classList.add("bg-black");
    } else {
      document.body.classList.remove("bg-black");
      document.body.classList.add("bg-white");
    }
    return () => {
      document.body.classList.remove("bg-white", "bg-black");
    };
  }, [darkMode]);

  return (
    <div
      className={`min-h-screen transition-colors ${
        darkMode
          ? "text-white selection:bg-white/20 selection:text-white"
          : "text-black selection:bg-black/20 selection:text-black"
      }`}
    >
      <HeaderSection
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode(!darkMode)}
      />

      <HeroSection darkMode={darkMode} />

      <ProblemSection darkMode={darkMode} />

      <SolutionSection darkMode={darkMode} />

      <MerchantOsSection darkMode={darkMode} />

      <AudienceSection darkMode={darkMode} />

      <FAQSection darkMode={darkMode} />

      <CTASection darkMode={darkMode} />

      <FooterSection darkMode={darkMode} />
    </div>
  );
}
