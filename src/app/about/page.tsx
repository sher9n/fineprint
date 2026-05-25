import Link from "next/link";
import { AppShell } from "@/components/AppShell";

export default function AboutPage() {
  return (
    <AppShell>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
        <h1 className="text-3xl font-semibold tracking-tight">About Fineprint</h1>
        <p className="text-base text-[var(--text-muted)] leading-relaxed">
          Fineprint is a tool that reads the fine print on every active Polymarket market and surfaces the ones where the rules quietly say something different from what the price implies.
        </p>
        <p className="text-base text-[var(--text-muted)] leading-relaxed">
          We use Claude (Anthropic's AI) for the heavy lifting: reading the rules carefully, comparing them to what casual bettors would assume, and double-checking the most promising ones with a web search.
        </p>
        <p className="text-base text-[var(--text-muted)] leading-relaxed">
          We don't place bets. We don't take your money. We're just a research tool that helps you spot opportunities you'd otherwise miss.
        </p>
        <div className="card p-5 text-sm text-[var(--text-muted)] leading-relaxed">
          <strong className="text-[var(--text)]">Open source.</strong> Fineprint is open source. You can read the code, run it yourself, or contribute improvements.
        </div>
        <Link href="/" className="btn btn-primary">Back to opportunities</Link>
      </div>
    </AppShell>
  );
}
