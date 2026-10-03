import type { Metadata } from "next";
import { Geist } from "next/font/google";

import { Header } from "@/components/header";

import "./globals.css";

const geist = Geist({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

export const metadata: Metadata = {
  title: "LectraLLM",
  description: "AI-powered lecture content validation and analysis",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={geist.variable}>
        <Header />
        {children}
      </body>
    </html>
  );
}
