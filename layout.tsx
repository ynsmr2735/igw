import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Insta Global Wallet — Paranız, sınır tanımıyor",
  description:
    "30+ para birimi, anında transfer, sanal kartlar ve güvenli dijital cüzdan deneyimi. Insta Global Wallet ile paranız dünyanın her yerinde.",
  applicationName: "Insta Global Wallet",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body className="bg-white text-[#10152b] antialiased">{children}</body>
    </html>
  );
}
