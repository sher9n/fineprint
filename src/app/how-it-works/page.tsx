import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Search, FileText, Sparkles, Vote, Wallet } from "lucide-react";

export default function HowItWorksPage() {
  const steps = [
    {
      icon: Search,
      title: "We scan every active Polymarket market every day",
      body: "Polymarket has thousands of bets at any moment. We pull every active one and store the full rules text, current price, and how much money is in play.",
    },
    {
      icon: FileText,
      title: "We read the fine print with Claude",
      body: "For every market, we ask Claude (Anthropic's AI) to compare the question text against the resolution rules. Are they saying the same thing? Or do the rules add deadlines, sources, or thresholds that change the math?",
    },
    {
      icon: Sparkles,
      title: "We verify the most promising ones with a web search",
      body: "When the rules diverge from the vibe, we run a second pass with web search. This catches stale markets where reality has already moved (e.g., a candidate has already been eliminated).",
    },
    {
      icon: Vote,
      title: "You see the opportunities, simply explained",
      body: "Every opportunity shows you: which side to buy, at what price, what the expected return is, and the reasoning in plain English. You can vote on them to help us learn which are most useful.",
    },
    {
      icon: Wallet,
      title: "You bet on Polymarket. You're in control.",
      body: "We never place bets for you. Open Polymarket, place the bet yourself, then come back and log it here so you can track your hit rate over time.",
    },
  ];

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">How Fineprint works</h1>
          <p className="text-base text-[var(--text-muted)] mt-2">
            We do the boring work of reading every market's fine print, so you can spot the ones where the rules disagree with the price.
          </p>
        </div>

        <div className="space-y-6">
          {steps.map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={i} className="flex gap-4">
                <div className="shrink-0 flex flex-col items-center">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                    <Icon className="w-5 h-5" />
                  </div>
                  {i < steps.length - 1 && <div className="w-px flex-1 bg-[var(--border)] mt-2" />}
                </div>
                <div className="flex-1 pb-2">
                  <h2 className="text-base sm:text-lg font-semibold">{s.title}</h2>
                  <p className="text-sm text-[var(--text-muted)] mt-1.5 leading-relaxed">{s.body}</p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="card p-6">
          <h3 className="text-sm font-medium mb-2">A few words of caution</h3>
          <ul className="text-sm text-[var(--text-muted)] space-y-1.5 leading-relaxed">
            <li>· Our analysis is AI-generated and can be wrong. Always double-check the rules and the current facts before betting.</li>
            <li>· Polymarket is a real money platform. Only bet what you can afford to lose.</li>
            <li>· &quot;Expected return&quot; assumes our probability estimate is right. It usually is roughly. Sometimes it's off.</li>
            <li>· Vote on opportunities you act on. We&apos;ll calibrate the system over time using community feedback.</li>
          </ul>
        </div>

        <div className="text-center">
          <Link href="/" className="btn btn-primary">See today's opportunities</Link>
        </div>
      </div>
    </AppShell>
  );
}
