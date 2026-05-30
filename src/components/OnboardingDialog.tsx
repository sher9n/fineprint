"use client";

import { useEffect, useState } from "react";
import { X, Coins, FileSearch, Newspaper, Hand } from "lucide-react";

const STORAGE_KEY = "fineprint_onboarded_v1";

export function OnboardingDialog() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem(STORAGE_KEY)) setOpen(true);
  }, []);

  function close() {
    localStorage.setItem(STORAGE_KEY, "1");
    setOpen(false);
  }

  if (!open) return null;

  const steps = [
    {
      icon: Coins,
      title: "Welcome to Fineprint",
      body: (
        <>
          <p>Polymarket lets you bet YES or NO on real-world questions, like &quot;Will the Fed cut rates in March?&quot;.</p>
          <p>A share costs whatever the crowd thinks the odds are, and pays $1 if you turn out right. A share at 30c means the crowd thinks there&apos;s a 30% chance.</p>
        </>
      ),
    },
    {
      icon: FileSearch,
      title: "We read the fine print",
      body: (
        <>
          <p>Every market has detailed rules. Sometimes those rules quietly say something stricter or different from what the question makes you assume.</p>
          <p>We read them carefully and flag the gaps that casual bettors miss.</p>
        </>
      ),
    },
    {
      icon: Newspaper,
      title: "And we watch the news",
      body: (
        <>
          <p>Other times the real world has already pointed to an answer, but the price hasn&apos;t caught up yet.</p>
          <p>We check the facts against trusted sources and flag those too.</p>
        </>
      ),
    },
    {
      icon: Hand,
      title: "You decide, and you bet",
      body: (
        <>
          <p>Each pick shows what to buy, what it costs, and what you could win, in plain English.</p>
          <p>You place the bet on Polymarket yourself. We never bet for you, and we never touch your money.</p>
        </>
      ),
    },
  ];

  const Step = steps[step];
  const Icon = Step.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={close} />
      <div className="relative w-full max-w-md card-elev p-7 sm:p-8 animate-rise-in">
        <button className="absolute top-4 right-4 p-2 rounded-full hover:bg-[var(--bg-overlay)]" onClick={close} aria-label="Close">
          <X className="w-4 h-4" />
        </button>

        <div className="w-13 h-13 rounded-2xl flex items-center justify-center mb-5" style={{ background: "var(--accent-soft)", color: "var(--accent)", width: 52, height: 52 }}>
          <Icon className="w-6 h-6" />
        </div>

        <h2 className="font-display text-[24px] text-[var(--text)] mb-3">{Step.title}</h2>
        <div className="space-y-3 text-[15px] leading-relaxed text-[var(--text-muted)] mb-7">{Step.body}</div>

        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {steps.map((_, i) => (
              <div key={i} className={`h-2 rounded-full transition-all ${i === step ? "w-7 bg-[var(--accent)]" : "w-2 bg-[var(--border-strong)]"}`} />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 && <button className="btn btn-ghost" onClick={() => setStep(step - 1)}>Back</button>}
            {step < steps.length - 1 ? (
              <button className="btn btn-primary" onClick={() => setStep(step + 1)}>Next</button>
            ) : (
              <button className="btn btn-primary" onClick={close}>Show me the picks</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
