import { ShieldCheck, Check, AlertTriangle, Eye } from "lucide-react";
import { trustLabel } from "@/lib/explain";
import { cn } from "@/lib/utils";

/**
 * Plain-language trust signal. One AI = "Checked", two that agree = "Double-checked",
 * two that disagree = "Mixed views", nothing deep yet = "Quick scan". Model names and
 * pipeline stages stay out of the user's way (they live in the detail page's Details panel).
 */
export function TrustBadge({ stage, size = "md" }: { stage: string | undefined | null; size?: "sm" | "md" }) {
  const { label, tone, detail } = trustLabel(stage);
  const Icon = tone === "green" ? (label === "Double-checked" ? ShieldCheck : Check) : tone === "amber" ? AlertTriangle : Eye;
  const toneCls =
    tone === "green" ? "text-[var(--green)] bg-[var(--green-soft)]"
    : tone === "amber" ? "text-[var(--amber)] bg-[var(--amber-soft)]"
    : "text-[var(--text-muted)] bg-[var(--bg-elev-2)]";
  const sizeCls = size === "sm" ? "text-[11px] px-2 py-0.5 gap-1" : "text-[12.5px] px-2.5 py-1 gap-1.5";
  const iconCls = size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5";
  return (
    <span title={detail} className={cn("inline-flex items-center rounded-full font-semibold", toneCls, sizeCls)}>
      <Icon className={iconCls} />
      {label}
    </span>
  );
}
