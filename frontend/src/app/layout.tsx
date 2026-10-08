import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import StoreProvider from "@/components/StoreProvider";
import PrivyAppProvider from "@/components/PrivyAppProvider";
import AuthSessionProvider from "@/components/AuthSessionProvider";
import { SurfacePickerProvider } from "@/components/SurfacePickerModal";
import ToastProvider from "@/components/ToastProvider";
import { QueryProvider } from "@/lib/query";
import { SessionProvider } from "@/lib/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "Adspaces — peer-to-peer ad space",
  description: "Sell ad space on anything. Buyers claim spots and fund what you are building.",
  icons: { icon: "/logo.svg" },
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
                <AuthSessionProvider>
                  <StoreProvider>
                    <SurfacePickerProvider>{children}</SurfacePickerProvider>
                  </StoreProvider>
                </AuthSessionProvider>
              </ToastProvider>
            </SessionProvider>
          </QueryProvider>
        </PrivyAppProvider>
      </body>
    </html>
  );
}
