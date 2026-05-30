import Link from "next/link";
import { Compass } from "lucide-react";
import { Logo } from "@/components/Logo";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)] relative z-[1]">
      <header className="px-4 sm:px-6 py-4">
        <Logo size="md" />
      </header>
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-5" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
            <Compass className="w-8 h-8" />
          </div>
          <h1 className="font-display text-[30px] text-[var(--text)] tight mb-2">Page not found</h1>
          <p className="text-[15px] text-[var(--text-muted)] mb-7">We couldn&apos;t find that page. The link may be wrong, or the pick may have closed.</p>
          <Link href="/" className="btn btn-primary btn-lg">Back to picks</Link>
        </div>
      </main>
    </div>
  );
}
