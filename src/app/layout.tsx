import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { Suspense } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { AppProviders } from "@/app/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ClipScribe",
  description: "Private browser-native transcription, subtitle versioning, and creator tools for audio and video.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} antialiased`}
      >
        <AppProviders>
          <Suspense fallback={<div className="min-h-screen bg-black" />}>
            <AppLayout>
              {children}
            </AppLayout>
          </Suspense>
        </AppProviders>
      </body>
    </html>
  );
}
