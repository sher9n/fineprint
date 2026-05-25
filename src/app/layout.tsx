import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { Session } from "next-auth";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { auth } from "@/lib/auth";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Fineprint",
  description: "Find hidden opportunities on Polymarket. We read the fine print so you don't have to.",
};

// Layout calls auth() which reads cookies — that's inherently dynamic. Force dynamic rendering
// for every route so Next.js doesn't try (and fail) to prerender pages at build time.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Render as logged-out on transient auth/DB failures so one bad lookup doesn't blank every route.
  let session: Session | null = null;
  try {
    session = await auth();
  } catch (err) {
    console.error("[layout] auth() failed:", err);
  }
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="antialiased min-h-screen">
        <Providers session={session}>{children}</Providers>
      </body>
    </html>
  );
}
