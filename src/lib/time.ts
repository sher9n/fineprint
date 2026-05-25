import { formatInTimeZone } from "date-fns-tz";

export const IST_TZ = "Asia/Kolkata";

export function fmtIst(date: Date | string | null | undefined, pattern = "yyyy-MM-dd HH:mm 'IST'") {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "-";
  return formatInTimeZone(d, IST_TZ, pattern);
}

export function fmtIstShort(date: Date | string | null | undefined) {
  return fmtIst(date, "MMM d, HH:mm 'IST'");
}

export function fmtIstDate(date: Date | string | null | undefined) {
  return fmtIst(date, "yyyy-MM-dd");
}

export function todayIstDateString() {
  return formatInTimeZone(new Date(), IST_TZ, "yyyy-MM-dd");
}

export function daysUntil(date: Date | string | null | undefined): number | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return null;
  const ms = d.getTime() - Date.now();
  return ms / (1000 * 60 * 60 * 24);
}

export function relativeFromNow(date: Date | string | null | undefined): string {
  const days = daysUntil(date);
  if (days == null) return "-";
  if (days < 0) {
    const abs = Math.abs(days);
    if (abs < 1) return `${Math.round(abs * 24)}h ago`;
    return `${Math.round(abs)}d ago`;
  }
  if (days < 1) return `in ${Math.round(days * 24)}h`;
  if (days < 60) return `in ${Math.round(days)}d`;
  return `in ${Math.round(days / 30)}mo`;
}
