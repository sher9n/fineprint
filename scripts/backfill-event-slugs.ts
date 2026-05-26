import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { fetchMarketById, normalize } from "../src/lib/polymarket";

const CONCURRENCY = 10;
const BATCH_LOG_EVERY = 100;

async function main() {
  const targets = await prisma.market.findMany({
    where: {
      eventSlug: null,
      groupItemTitle: { not: null },
      active: true,
      closed: false,
    },
    select: { id: true },
  });
  console.log(`Found ${targets.length} active grouped markets missing eventSlug.`);
  if (targets.length === 0) {
    await prisma.$disconnect();
    return;
  }

  let processed = 0;
  let updated = 0;
  let stillMissing = 0;
  let errors = 0;
  const start = Date.now();

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const chunk = targets.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async ({ id }) => {
        processed++;
        try {
          const raw = await fetchMarketById(id);
          if (!raw) return;
          const n = normalize(raw);
          if (!n) return;
          if (!n.eventSlug) {
            stillMissing++;
            return;
          }
          await prisma.market.update({
            where: { id },
            data: {
              eventSlug: n.eventSlug,
              eventTitle: n.eventTitle,
              groupItemTitle: n.groupItemTitle,
              negRiskMarketId: n.negRiskMarketId,
            },
          });
          updated++;
        } catch (err) {
          errors++;
          console.error(`[${id}]`, String(err).slice(0, 200));
        }
        if (processed % BATCH_LOG_EVERY === 0) {
          const elapsed = ((Date.now() - start) / 1000).toFixed(1);
          console.log(`${processed}/${targets.length} processed in ${elapsed}s — updated=${updated} stillMissing=${stillMissing} errors=${errors}`);
        }
      })
    );
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s.`);
  console.log(`  processed:     ${processed}`);
  console.log(`  updated:       ${updated}`);
  console.log(`  still missing: ${stillMissing} (gamma response had no events array)`);
  console.log(`  errors:        ${errors}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
