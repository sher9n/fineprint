import Link from "next/link";
import { cn } from "@/lib/utils";

export function Logo({ size = "md", asLink = true }: { size?: "sm" | "md" | "lg"; asLink?: boolean }) {
  const dim = size === "sm" ? "w-7 h-7" : size === "lg" ? "w-10 h-10" : "w-8 h-8";
  const textSize = size === "sm" ? "text-sm" : size === "lg" ? "text-xl" : "text-base";
  const inner = (
    <div className="flex items-center gap-2.5">
      <div className={cn(dim, "rounded-lg flex items-center justify-center relative overflow-hidden")} style={{ background: "linear-gradient(135deg, var(--accent), var(--purple))" }}>
        <svg viewBox="0 0 24 24" className="w-3/5 h-3/5 text-white" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="10" cy="10" r="6" />
          <line x1="14.5" y1="14.5" x2="20" y2="20" />
          <line x1="7" y1="9" x2="13" y2="9" />
          <line x1="7" y1="11.5" x2="11" y2="11.5" />
        </svg>
      </div>
      <div>
        <div className={cn(textSize, "font-semibold leading-tight tracking-tight text-[var(--text)]")}>Fineprint</div>
      </div>
    </div>
  );
  if (asLink) return <Link href="/">{inner}</Link>;
  return inner;
}
