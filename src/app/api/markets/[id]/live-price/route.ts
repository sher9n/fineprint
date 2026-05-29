import { NextRequest, NextResponse } from "next/server";
import { normalize, type RawMarket } from "@/lib/polymarket";

export const runtime = "nodejs";
// Short revalidate so multiple page views within 30s share one Gamma call. Per-page-view freshness
// is still ~30s which matches the page's 60s client poll comfortably.
export const revalidate = 30;

const GAMMA_URL = process.env.POLYMARKET_GAMMA_URL || "https://gamma-api.polymarket.com";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = `${GAMMA_URL}/markets/${encodeURIComponent(id)}`;
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      next: { revalidate: 30 },
    });
    if (res.status === 404) return NextResponse.json({ error: "market not found" }, { status: 404 });
    if (!res.ok) return NextResponse.json({ error: `gamma ${res.status}` }, { status: 502 });
    const raw = (await res.json()) as RawMarket | null;
    if (!raw || !raw.id) return NextResponse.json({ error: "market not found" }, { status: 404 });
    const n = normalize(raw);
    if (!n) return NextResponse.json({ error: "could not normalize gamma response" }, { status: 502 });
    return NextResponse.json({
      yesPrice: n.yesPrice,
      noPrice: n.noPrice,
      yesAsk: n.yesAsk,
      noAsk: n.noAsk,
      spread: n.spread,
      active: n.active,
      closed: n.closed,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 200) }, { status: 500 });
  }
}
