import Link from "next/link";
import { Logo } from "@/components/Logo";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)]">
      <header className="px-4 sm:px-6 py-4">
        <Logo size="md" />
      </header>
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-4">🔍</div>
          <h1 className="text-3xl font-semibold tracking-tight mb-2">Page not found</h1>
          <p className="text-sm text-[var(--text-muted)] mb-6">
            We couldn&apos;t find what you were looking for. The link may be wrong, or the opportunity may have closed.
          </p>
          <Link href="/" className="btn btn-primary">Back to opportunities</Link>
        </div>
      </main>
    </div>
  );
}
