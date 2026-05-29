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
  bestBid?: number | string;
  bestAsk?: number | string;
  spread?: number | string;
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
  // Order-book derived buy-side prices. yesAsk = lowest someone will sell YES for (= what you
  // pay to buy YES). noAsk = 1 - bestBid (because buying NO == taking the YES bid). These reflect
  // what Polymarket's UI shows in the Buy column and what the user actually pays, including
  // the bid-ask spread. They do NOT sum to 1.0 (they sum to 1 + spread).
  yesAsk: number | null;
  noAsk: number | null;
  spread: number | null;
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
    yesAsk: raw.bestAsk != null ? toNumber(raw.bestAsk) : null,
    noAsk: raw.bestBid != null ? 1 - toNumber(raw.bestBid) : null,
    spread: raw.spread != null ? toNumber(raw.spread) : null,
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
  // Use the listing endpoint with an id filter instead of /markets/{id}. The single-market
  // endpoint omits the `events` array, which means reconciliation silently strips a market's
  // event association on every refetch. The listing form preserves it.
  //
  // Quirk: the listing endpoint defaults to open markets only — `?id=X&limit=1` returns []
  // for resolved markets. Surfaced 2026-05-29 when the Sinner French Open market resolved
  // but our reconcile silently skipped it because the open-only listing returned [], and
  // upserted nothing. Result: 1,240 closed-but-not-reconciled markets accumulated in the DB.
  // Fix: if the open-listing call returns empty, retry with closed=true. Both forms preserve
  // the events array; the single-market endpoint does not.
  async function fetchOne(extraQS: string): Promise<RawMarket[]> {
    const url = `${GAMMA_URL}/markets?id=${encodeURIComponent(id)}${extraQS}&limit=1`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`gamma fetch ${id} ${res.status}: ${await res.text().catch(() => "")}`);
    const data = (await res.json()) as RawMarket[] | null;
    return Array.isArray(data) ? data : [];
  }

  let data = await fetchOne("");
  if (data.length === 0) data = await fetchOne("&closed=true");
  if (data.length === 0) return null;
  const first = data[0];
  return first && first.id ? first : null;
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

/**
 * Pull historical closed/resolved markets. We need these in the DB so the verifier's
 * resolvedSiblings query can surface prior-variant resolutions ("the resolver has already
 * answered this kind of question, and here's how"), which is the single strongest signal
 * for recurring-series markets. Stops paginating when a page returns zero novel ids.
 */
/**
 * Pull historical closed/resolved markets via Gamma's keyset (cursor) endpoint. The offset-based
 * /markets endpoint hard-caps at offset 10000 (it returns "validation error: offset too large,
 * use /markets/keyset for deeper pagination"), and Polymarket has way more than 10K closed
 * markets, so we paginate by cursor here.
 *
 * Why we need these in the DB: the verifier's resolvedSiblings query in src/lib/batch.ts looks
 * for closed markets with overlapping keywords so Opus can reason about resolver precedent ("the
 * resolver has already answered this kind of question, here's how"). For markets that resolved
 * before our ingest started, those rows aren't in the DB and the precedent signal silently drops.
 */
export async function fetchAllClosedMarkets(opts?: {
  maxPages?: number;
  onPage?: (page: RawMarket[], cursor: string) => void | Promise<void>;
}): Promise<RawMarket[]> {
  const maxPages = opts?.maxPages ?? 500;
  const all: RawMarket[] = [];
  const seen = new Set<string>();
  let cursor = "";
  for (let i = 0; i < maxPages; i++) {
    const params = new URLSearchParams();
    params.set("limit", "100");
    params.set("active", "false");
    params.set("closed", "true");
    if (cursor) params.set("after_cursor", cursor);
    const url = `${GAMMA_URL}/markets/keyset?${params.toString()}`;
    // Retry-on-transient-network. Long backfills (60K markets, 600+ pages) have a non-trivial
    // chance of one ECONNRESET / "fetch failed" mid-run; without retry the whole pass gets
    // thrown out. Exponential backoff up to 5 attempts. Non-transient (4xx) still throws.
    let body: { markets?: RawMarket[]; next_cursor?: string } | null = null;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const res = await fetch(url, { headers: { accept: "application/json" } });
        if (!res.ok) throw new Error(`gamma keyset ${res.status}: ${await res.text().catch(() => "")}`);
        body = (await res.json()) as { markets?: RawMarket[]; next_cursor?: string };
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const msg = String(err);
        const transient = msg.includes("ECONNRESET") || msg.includes("ETIMEDOUT") || msg.includes("fetch failed") || msg.includes("ENETUNREACH") || msg.includes("EAI_AGAIN") || /gamma keyset 5\d{2}/.test(msg);
        if (!transient || attempt === 4) break;
        const delay = 1500 * Math.pow(2, attempt) + Math.random() * 750;
        console.warn(`[gamma keyset] page ${i + 1} transient: ${msg.slice(0, 80)} — retry ${attempt + 1}/4 in ${Math.round(delay)}ms`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    if (!body) throw lastErr;
    const page = Array.isArray(body.markets) ? body.markets : [];
    if (!page.length) break;
    let novel = 0;
    for (const m of page) {
      if (m.id && !seen.has(m.id)) {
        seen.add(m.id);
        all.push(m);
        novel++;
      }
    }
    await opts?.onPage?.(page, cursor);
    if (novel === 0) break;
    if (!body.next_cursor || body.next_cursor === cursor) break;
    cursor = body.next_cursor;
  }
  return all;
}

export function polymarketUrl(slug: string) {
  return `https://polymarket.com/market/${slug}`;
}

/**
 * Build the most stable Polymarket URL we can for a given market.
 *
 * The market-level slug rotates: Polymarket appends numeric suffixes after creation, so a slug
 * we ingested yesterday may render as "Oops, we didn't forecast this" today even at the
 * canonical /event/{eventSlug}/{slug} URL. Worse, the page returns HTTP 200 with an empty-state
 * payload, so naive curl checks pass.
 *
 * The event slug doesn't rotate. We link to the bare /event/{eventSlug} when available so the
 * link is robust to slug churn; the user lands on the event page showing all outcomes as tiles
 * and clicks the right one. For non-grouped binaries (no eventSlug) we fall back to
 * /market/{slug} and accept that it may occasionally 404 between ingests.
 */
export function marketDisplayUrl(m: { slug: string; eventSlug?: string | null }): string {
  if (m.eventSlug) return `https://polymarket.com/event/${m.eventSlug}`;
  return `https://polymarket.com/market/${m.slug}`;
}
