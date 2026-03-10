import type { ReactNode } from "react";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

const composerSans = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-composer-sans",
  display: "swap",
});

const composerMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-composer-mono",
  display: "swap",
});

export default function CreatorComposerLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <div className={`${composerSans.variable} ${composerMono.variable} composer-workspace`}>
      {children}
    </div>
  );
}
