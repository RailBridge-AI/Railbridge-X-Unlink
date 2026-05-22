import "./globals.css";

export const metadata = {
  title: "RailBridge Merchant Console",
  description: "Custodial stablecoin payment operations platform for agent commerce"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-slate-100 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
