import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Fineprint wordmark: just the name set in Fraunces. No icon.
 */
export function Logo({ size = "md", asLink = true }: { size?: "sm" | "md" | "lg"; asLink?: boolean }) {
  const text = size === "sm" ? "text-[21px]" : size === "lg" ? "text-[30px]" : "text-[25px]";
  const inner = <span className={cn("wordmark leading-none text-[var(--text)]", text)}>Fineprint</span>;
  if (asLink) return <Link href="/" aria-label="Fineprint home" className="inline-flex items-center">{inner}</Link>;
  return inner;
}
