# Fineprint

Find Polymarket markets where the **resolution rules quietly say something different** from the lay reading of the question. We audit the fine print and surface opportunities a casual bettor would miss.

## How it works (the four-pass pipeline)

For each Polymarket market we ingest, the system can run up to four analyses:

| Pass | Model | Trigger | Purpose |
|---|---|---|---|
| `haiku` / `sonnet` (first-pass) | Claude Haiku 4.5 or Sonnet 4.6 | Daily batch | Cheap first read on every market. Scores rule vs vibe divergence 0-10. |
| `opus` (verifier) | Claude Opus 4.8 + web search | Auto when first-pass divergence ≥ 5 and edge ≥ 20 | Web-searches named sources, verifies facts, refines the verdict. |
| `gpt_deep` (third opinion) | OpenAI o3-deep-research | Manual admin trigger per market | Independent deep-research read with its own browsing and reasoning. |
| `synthesis` | Claude Opus 4.8 | Auto after `gpt_deep` completes | Reads both Opus + GPT, produces a final verdict, flags agreement/disagreement. |

The first two passes are automated. Deep research is **strictly manual, one market at a time** (it's expensive: $1-2 per call).

For each verified market the UI shows:
- An opportunity score (0-100) with a tooltip breaking down its components.
- "Buy NO at X¢, expected payout Y¢, +Z% expected return" computed against the **live** Polymarket price (refreshed via the Gamma API every 30s server-side).
- For markets with 50-50 fallback rules, a three-scenario breakdown showing probability × payout × profit for each outcome.
- An "Edge has evaporated" amber state when the live price has drifted past the analysis estimate.
- For markets with both Opus + GPT analyses: side-by-side evidence panels, plus a "Both models agree" or "Models disagree" banner above the synthesis.

## Tech

- Next.js 16 (App Router, Turbopack) + React 19
- TypeScript, Tailwind CSS 4
- Postgres + Prisma 6 (Auth.js v5 with the Prisma adapter)
- Anthropic SDK (Claude) + OpenAI SDK (deep research only)
- React Query for client-side data, sonner for toasts
- Hosted on Railway via the bundled `Dockerfile` + `railway.toml`

## Local development

Prerequisites: Node 22, Postgres 16+ on `localhost:5432`, an Anthropic API key. OpenAI key is optional (only needed to manually trigger GPT deep-research).

```bash
# 1. Copy env template and fill in real values
cp .env.example .env

# 2. Install deps and generate Prisma client
npm install

# 3. Set up the local database
createdb fineprint
npx prisma migrate deploy

# 4. Run dev server
npm run dev
# → http://localhost:3001
```

The scheduler fires the daily ingest at 05:00 IST automatically when the dev server is running. To manually kick off an ingest now (admin-only):

```bash
curl -X POST http://localhost:3001/api/ingest
```

Magic-link sign-in logs the link to your console if `RESEND_API_KEY` is empty in `.env` (so you don't need a Resend account for local dev).

## Environment variables

See `.env.example` for the full list with comments. The non-obvious ones:

- `ADMIN_EMAILS` — comma-separated list of email addresses that get admin access (Runs page, Verify with Opus, Deep-research with GPT, settings, etc.).
- `DAILY_LLM_BUDGET_USD` — soft cap on Anthropic spend per IST day. The pipeline stops calling Claude when exceeded.
- `DAILY_DEEP_RESEARCH_BUDGET_USD` — separate cap on OpenAI deep-research spend (since it's expensive and manual-only).
- `OPENAI_DEEP_RESEARCH_MODEL` — defaults to `o3-deep-research`. Note: as of this writing, OpenAI gates deep-research access per endpoint — your project needs both Responses-API access AND batch-API access if you want to use batch mode.
- `DAILY_RUN_HOUR_IST` — hour of day (in `APP_TIMEZONE`) when the daily ingest cron fires.

## Deployment

The project is set up for Railway:

1. Push to GitHub.
2. Create a Railway project, link the repo.
3. Add a Postgres addon (Railway auto-injects `DATABASE_URL`).
4. Set the required env vars in Railway's dashboard:
   - `ANTHROPIC_API_KEY`
   - `OPENAI_API_KEY` (only if you want deep-research)
   - `AUTH_SECRET` (generate with `openssl rand -base64 32`)
   - `AUTH_URL` (your production URL)
   - `RESEND_API_KEY` + `RESEND_FROM_EMAIL` (for magic-link sign-in)
   - `ADMIN_EMAILS`
5. Railway will build using the `Dockerfile`, run `prisma migrate deploy` on every boot, and start the Next.js server on port 3000.

Health check is at `/api/health`. Use `/api/version` to verify a deploy landed:

```bash
curl https://your-domain.com/api/version
# { "ok": true, "commit": "abc1234...", "commit_short": "abc1234", "time": "..." }
```

Railway sets `RAILWAY_GIT_COMMIT_SHA` automatically, so the `commit` field reflects whatever's actually running.

## Scripts

- `npm run dev` — dev server on :3001 with Turbopack.
- `npm run build` — production build (`prisma generate && next build`).
- `npm start` — start the production server on :3001.
- `npm run lint` — ESLint.
- `npm run db:migrate` — apply pending Prisma migrations.
- `npm run db:studio` — open Prisma Studio.

One-off ops scripts in `scripts/`:

- `scripts/reconcile-closed.ts` — re-checks every active+open market in the DB against Polymarket Gamma, updates anything that has since closed. Runs automatically as part of the daily ingest, but you can run it manually too: `npx tsx scripts/reconcile-closed.ts`.
- `scripts/inspect-batch.ts <batch_id>` — dumps an OpenAI batch's state, output file, and error file. For debugging deep-research failures.
- `scripts/backfill-verifier.ts` — submits a bulk re-verification batch.

## Not financial advice

The system surfaces opportunities; you decide. There's an "Initial analysis only" caveat where a market hasn't been verified, and an "Edge has evaporated" warning when the live price has drifted past the analysis estimate. Both are honest signals — pay attention to them.
