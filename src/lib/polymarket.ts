const GAMMA_URL = process.env.POLYMARKET_GAMMA_URL || "https://gamma-api.polymarket.com";

export interface RawMarketEvent {
  id?: string;
  title?: string;
  slug?: string;
}

export interface RawMarket {
  id: string;
  conditionId?: string;
  slug?: string;
  question?: string;
  description?: string;
  resolutionSource?: string;
  endDate?: string;
  startDate?: string;
  liquidity?: string | number;
  volume?: string | number;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  image?: string;
  icon?: string;
  groupItemTitle?: string;
  negRiskMarketID?: string;
  events?: RawMarketEvent[];
}

function toJsonArr(v: string | string[] | undefined): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toNumber(v: string | number | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

export interface NormalizedMarket {
  id: string;
  conditionId: string;
  slug: string;
  question: string;
  description: string;
  resolutionSource: string | null;
  endDate: Date | null;
  startDate: Date | null;
  liquidity: number;
  volume: number;
  outcomes: string[];
  outcomePrices: number[];
  yesPrice: number | null;
  noPrice: number | null;
  active: boolean;
  closed: boolean;
  imageUrl: string | null;
  eventTitle: string | null;
  eventSlug: string | null;
  groupItemTitle: string | null;
  negRiskMarketId: string | null;
}

export function normalize(raw: RawMarket): NormalizedMarket | null {
  if (!raw.id || !raw.conditionId || !raw.question) return null;
  const outcomes = toJsonArr(raw.outcomes);
  const priceStrs = toJsonArr(raw.outcomePrices);
  const prices = priceStrs.map((p) => parseFloat(p)).filter((n) => !isNaN(n));
  const yesIdx = outcomes.findIndex((o) => o.toLowerCase() === "yes");
  const noIdx = outcomes.findIndex((o) => o.toLowerCase() === "no");
  const firstEvent = raw.events && raw.events.length > 0 ? raw.events[0] : null;
  return {
    id: raw.id,
    conditionId: raw.conditionId,
    slug: raw.slug || "",
    question: raw.question,
    description: raw.description || "",
    resolutionSource: raw.resolutionSource && raw.resolutionSource.length > 0 ? raw.resolutionSource : null,
    endDate: raw.endDate ? new Date(raw.endDate) : null,
    startDate: raw.startDate ? new Date(raw.startDate) : null,
    liquidity: toNumber(raw.liquidity),
    volume: toNumber(raw.volume),
    outcomes,
    outcomePrices: prices,
    yesPrice: yesIdx >= 0 && prices[yesIdx] != null ? prices[yesIdx] : null,
    noPrice: noIdx >= 0 && prices[noIdx] != null ? prices[noIdx] : null,
    active: raw.active !== false,
    closed: raw.closed === true,
    imageUrl: raw.image || raw.icon || null,
    eventTitle: firstEvent?.title || null,
    eventSlug: firstEvent?.slug || null,
    groupItemTitle: raw.groupItemTitle || null,
    negRiskMarketId: raw.negRiskMarketID || null,
  };
}

export async function fetchMarketsPage(opts: {
  limit?: number;
  offset?: number;
  active?: boolean;
  closed?: boolean;
}): Promise<RawMarket[]> {
  const params = new URLSearchParams();
  params.set("limit", String(opts.limit ?? 100));
  params.set("offset", String(opts.offset ?? 0));
  if (opts.active != null) params.set("active", String(opts.active));
  if (opts.closed != null) params.set("closed", String(opts.closed));
  const url = `${GAMMA_URL}/markets?${params.toString()}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`gamma fetch ${res.status}: ${await res.text().catch(() => "")}`);
  const data = (await res.json()) as RawMarket[];
  return Array.isArray(data) ? data : [];
}

export async function fetchMarketById(id: string): Promise<RawMarket | null> {
  const url = `${GAMMA_URL}/markets/${encodeURIComponent(id)}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`gamma fetch ${id} ${res.status}: ${await res.text().catch(() => "")}`);
  const data = (await res.json()) as RawMarket | null;
  return data && data.id ? data : null;
}

export async function fetchAllOpenMarkets(opts?: {
  maxPages?: number;
  pageSize?: number;
  onPage?: (page: RawMarket[], offset: number) => void;
}): Promise<RawMarket[]> {
  const pageSize = opts?.pageSize ?? 100;
  const maxPages = opts?.maxPages ?? 80;
  const all: RawMarket[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchMarketsPage({ limit: pageSize, offset, active: true, closed: false });
    if (!page.length) break;
    let novel = 0;
    for (const m of page) {
      if (m.id && !seen.has(m.id)) {
        seen.add(m.id);
        all.push(m);
        novel++;
      }
    }
    opts?.onPage?.(page, offset);
    if (novel === 0) break;
    offset += pageSize;
  }
  return all;
}

export function polymarketUrl(slug: string) {
  return `https://polymarket.com/market/${slug}`;
}
