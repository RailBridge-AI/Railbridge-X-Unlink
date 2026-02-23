import "./globals.css";

export const metadata = {
  title: "RailBridge Merchant OS",
  description: "Merchant Treasury OS demo app"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-slate-100 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        {children}
      </body>
    </html>
  );
}
