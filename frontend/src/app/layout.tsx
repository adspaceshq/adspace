import type { Metadata } from "next";
import StoreProvider from "@/components/StoreProvider";
import PrivyAppProvider from "@/components/PrivyAppProvider";
import AuthSessionProvider from "@/components/AuthSessionProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Adspaces — peer-to-peer ad space",
  description: "Sell ad space on anything. Buyers claim spots and fund what you are building.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="flex min-h-full flex-col">
        <PrivyAppProvider>
          <AuthSessionProvider>
            <StoreProvider>{children}</StoreProvider>
          </AuthSessionProvider>
        </PrivyAppProvider>
      </body>
    </html>
  );
}
