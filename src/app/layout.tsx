import type { Metadata } from "next";
import { Sora, JetBrains_Mono } from "next/font/google";
import type { Session } from "next-auth";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { auth } from "@/lib/auth";

// One theme ("Obsidian"): Sora for the UI, JetBrains Mono for prices and percentages.
const sora = Sora({ variable: "--font-sora", subsets: ["latin"], display: "swap" });
const jetbrainsMono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Fineprint",
  description: "Find good bets on Polymarket. We read the fine print so you don't have to.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let session: Session | null = null;
  try {
    session = await auth();
  } catch (err) {
    console.error("[layout] auth() failed:", err);
  }
  const fontClasses = [sora.variable, jetbrainsMono.variable].join(" ");
  return (
    <html lang="en" suppressHydrationWarning className={fontClasses}>
      <body className="antialiased min-h-screen">
        <Providers session={session}>{children}</Providers>
      </body>
    </html>
  );
}
