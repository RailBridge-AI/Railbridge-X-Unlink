import "./globals.css";

export const metadata = {
  title: "RailBridge AI — Merchant OS for Onchain Revenue Operations",
  description:
    "Accept x402 payments across chains and manage balances, settlements, and payouts from Merchant OS.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
