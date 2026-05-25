"use client";

import { BadgeCheck, ShieldCheck, AlertTriangle, Sparkles, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Stage = "initial" | "opus_only" | "gpt_only" | "opus_and_gpt" | "synthesis_agreed" | "synthesis_disagreed";

interface Props {
  stage: string | undefined;
  size?: "sm" | "md";
  hideInitial?: boolean;
}

export function VerifyStageBadge({ stage, size = "md", hideInitial = true }: Props) {
  const s = (stage as Stage) ?? "initial";
  if (s === "initial" && hideInitial) return null;

  const cls = size === "sm" ? "text-[10px] gap-0.5 px-1 py-0" : "text-xs gap-1 px-1.5 py-0.5";
  const iconCls = size === "sm" ? "w-2.5 h-2.5" : "w-3 h-3";

  if (s === "synthesis_agreed") {
    return (
      <span className={cn("inline-flex items-center rounded-md text-[var(--green)]", cls)} title="Opus and GPT deep-research independently reached the same conclusion. Synthesis verdict is final.">
        <ShieldCheck className={iconCls} /> Both models agree
      </span>
    );
  }
  if (s === "synthesis_disagreed") {
    return (
      <span className={cn("inline-flex items-center rounded-md text-[var(--amber)]", cls)} title="Opus and GPT deep-research disagree on the bet side. Review both verdicts before betting.">
        <AlertTriangle className={iconCls} /> Models disagree
      </span>
    );
  }
  if (s === "opus_and_gpt") {
    return (
      <span className={cn("inline-flex items-center rounded-md text-[var(--text-muted)]", cls)} title="Both models have run; synthesis pass is queued.">
        <Loader2 className={cn(iconCls, "animate-spin")} /> Synthesizing
      </span>
    );
  }
  if (s === "gpt_only") {
    return (
      <span className={cn("inline-flex items-center rounded-md text-[var(--purple)]", cls)} title="GPT deep-research completed (no Opus verification yet)">
        <Sparkles className={iconCls} /> GPT confirmed
      </span>
    );
  }
  if (s === "opus_only") {
    return (
      <span className={cn("inline-flex items-center rounded-md text-[var(--green)]", cls)} title="Confirmed by Opus with web search">
        <BadgeCheck className={iconCls} /> Confirmed
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center rounded-md text-[var(--text-dim)]", cls)} title="First-pass analysis only">
      Initial
    </span>
  );
}
