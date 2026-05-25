import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { writeFileSync } from "fs";

async function main() {
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    title: string;
    yesPrice: number | null;
    noPrice: number | null;
    end_date_ist: string;
    divergenceScore: number;
    divergenceType: string;
    edgeDirection: string;
    betSide: string;
    ruleImpliedProbability: number | null;
    reasoning: string;
    sourceFindings: string | null;
    description: string;
  }>>(`
    WITH latest_opus AS (
      SELECT DISTINCT ON ("marketId") *
      FROM "Analysis" WHERE pass='opus' AND model='claude-opus-4-7'
      ORDER BY "marketId", "createdAt" DESC
    )
    SELECT m.id,
      COALESCE(NULLIF(m."eventTitle",'') || ' — ' || NULLIF(m."groupItemTitle",''), m.question) AS title,
      m."yesPrice", m."noPrice",
      to_char(m."endDate" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS end_date_ist,
      o."divergenceScore", o."divergenceType", o."edgeDirection", o."betSide",
      o."ruleImpliedProbability", o.reasoning, o."sourceFindings", m.description
    FROM latest_opus o
    JOIN "Market" m ON m.id = o."marketId"
    WHERE m.active=true AND m.closed=false AND (m."endDate" IS NULL OR m."endDate" > NOW())
    ORDER BY o."divergenceScore" DESC, o."edgeScore" DESC
    LIMIT 15;
  `);

  for (const r of rows) {
    writeFileSync(`/tmp/market-${r.id}.json`, JSON.stringify(r, null, 2));
    console.log(`Wrote /tmp/market-${r.id}.json  | ${r.title.slice(0, 60)} | div=${r.divergenceScore} bet=${r.betSide}`);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
