import Link from "next/link";
import { Mail } from "lucide-react";
import { Logo } from "@/components/Logo";

export default function CheckEmailPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)] relative z-[1]">
      <header className="px-4 sm:px-6 py-4">
        <Logo size="md" />
      </header>
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-5" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
            <Mail className="w-8 h-8" />
          </div>
          <h1 className="font-display text-[28px] text-[var(--text)] tight mb-2">Check your email</h1>
          <p className="text-[15px] text-[var(--text-muted)] leading-relaxed">
            We sent you a link to sign in. Click it to continue. You can close this tab.
          </p>
          <p className="text-[13px] text-[var(--text-dim)] mt-7">
            Don&apos;t see it? Check your spam folder. <Link href="/login" className="text-[var(--accent)] hover:underline">Try a different email</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
