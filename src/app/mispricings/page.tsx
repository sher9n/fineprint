"use client";

// Mispricings tab — same view as Opportunities, different category. The route owns the
// category state so a deep link / shared URL preserves which tab the user wanted to see.
import { MarketsView } from "../page";

export default function MispricingsPage() {
  return <MarketsView category="mispricings" />;
}
