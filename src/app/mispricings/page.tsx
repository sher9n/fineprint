"use client";

// Legacy route. The feed is now unified at "/", so this renders the same picks list with the
// "news moved" reason preselected. Kept so existing links keep working.
import { MarketsView } from "../page";

export default function MispricingsPage() {
  return <MarketsView initialKind="news" />;
}
