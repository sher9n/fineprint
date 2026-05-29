"use client";

import { Tooltip } from "./Tooltip";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { divergenceTypeLabel } from "@/lib/explain";

export function DivergenceTooltip({ divergenceScore, divergenceType, size = "md", pass }: { divergenceScore: number; divergenceType?: string; size?: "sm" | "md"; pass?: string }) {
  // For pass='obvious' the same 0-10 column stores CONFIDENCE in the world-state mispricing
  // pass, not fineprint divergence. We render the chip with different labels + tooltip copy.
  const isObvious = pass === "obvious";
  const labelSize = size === "sm" ? "text-[8px]" : "text-[9px]";
  const valueSize = size === "sm" ? "text-[11px]" : "text-[11px]";
  const containerSize = size === "sm" ? "px-1.5 py-0.5 gap-0.5" : "px-2 py-0.5 gap-1";
  const numberColor = divergenceScore >= 7 ? "text-[var(--red)]" : divergenceScore >= 5 ? "text-[var(--amber)]" : divergenceScore >= 3 ? "text-[var(--accent)]" : "text-[var(--text)]";

  const tierFineprint =
    divergenceScore >= 9 ? "Dramatic gap (9-10) — rules guarantee or strongly tilt toward a specific outcome."
    : divergenceScore >= 7 ? "Clear edge (7-8) — rules say something noticeably different from what bettors assume. Most miss it."
    : divergenceScore >= 5 ? "Real divergence (5-6) — visible to careful readers, some edge."
    : divergenceScore >= 3 ? "Minor difference (3-4) — wording is slightly off but not very actionable."
    : "Rules match the vibe (0-2) — no actionable gap.";

  const tierObvious =
    divergenceScore >= 9 ? "Primary source confirmed (9-10) — the event has happened or the resolver has published. Highest signal."
    : divergenceScore >= 7 ? "Strong evidence (7-8) — multiple independent primary or near-primary sources converge."
    : divergenceScore >= 5 ? "Meaningful indirect evidence (5-6) — directional signal with real backing but not crystallized."
    : divergenceScore >= 3 ? "Tentative directional signal (3-4) — speculation with some support; don't act on its own."
    : "No actionable signal (0-2) — model can't form a confident view from web evidence.";

  const tier = isObvious ? tierObvious : tierFineprint;

  const type = divergenceType ? divergenceTypeLabel(divergenceType) : null;
  const chipLabel = isObvious ? "Conf" : "Div";
  const tooltipTitle = isObvious ? "Confidence score" : "Mismatch score";
  const tooltipIntro = isObvious
    ? "How confident the model is that the current world state contradicts the market price. Based on what web search of primary sources reveals."
    : "How big the gap is between what the rules actually say and what most bettors assume from the question.";
  const tooltipFooter = isObvious
    ? "9-10 Primary source · 7-8 Strong · 5-6 Real · 3-4 Tentative · 0-2 None"
    : "9-10 Dramatic · 7-8 Clear · 5-6 Real · 3-4 Minor · 0-2 None";

  const chip = (
    <span className={cn("inline-flex items-center rounded-md border bg-[var(--bg-elev-2)] border-[var(--border)] cursor-default select-none whitespace-nowrap", containerSize)}>
      <span className={cn("uppercase tracking-wider text-[var(--text-dim)]", labelSize)}>{chipLabel}</span>
      <span className={cn("mono font-semibold", valueSize, numberColor)}>{divergenceScore}/10</span>
      <Info className={cn("opacity-50 text-[var(--text-dim)] ml-0.5", size === "sm" ? "w-2.5 h-2.5" : "w-3 h-3")} />
    </span>
  );

  return (
    <Tooltip
      width={320}
      align="left"
      hint={`${divergenceScore} / 10`}
      title={tooltipTitle}
      body={
        <>
          <p>{tooltipIntro}</p>
          <p className="text-[var(--text)] mt-1.5">{tier}</p>
          {type && (
            <div className="mt-2 pt-2 border-t border-[var(--border)]">
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)] mb-1">Type for this market</div>
              <div className="text-[var(--text)] font-medium">{type.short}</div>
              <p className="text-[var(--text-muted)] mt-0.5 text-[11px]">{type.explainer}</p>
            </div>
          )}
          <p className="text-[10px] text-[var(--text-dim)] pt-2 mt-2 border-t border-[var(--border)]">
            {tooltipFooter}
          </p>
        </>
      }
    >
      {chip}
    </Tooltip>
  );
}
