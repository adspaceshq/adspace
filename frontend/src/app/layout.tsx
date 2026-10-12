import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import PrivyAppProvider from "@/components/PrivyAppProvider";
import ToastProvider from "@/components/ToastProvider";
import { QueryProvider } from "@/lib/query";
import { SessionProvider } from "@/lib/session";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://adspaces.fun";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "adspaces (devnet) — sell ad space on anything", template: "%s · adspaces (devnet)" },
  description: "Sell ad space on anything people see. Sponsors pay in USDC, held in escrow until delivery.",
  icons: { icon: "/logo.svg" },
  openGraph: { type: "website", siteName: "adspaces (devnet)", url: "/" },
  twitter: { card: "summary_large_image", site: "@adspacesfun" },
};

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full ${inter.variable} ${mono.variable}`}>
      <body className="flex min-h-full flex-col">
        <PrivyAppProvider>
          <QueryProvider>
            <SessionProvider>
              <ToastProvider>
                {children}
              </ToastProvider>
            </SessionProvider>
          </QueryProvider>
        </PrivyAppProvider>
      </body>
    </html>
  );
}
