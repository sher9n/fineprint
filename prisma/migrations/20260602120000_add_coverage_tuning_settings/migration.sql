-- Coverage-tuning knobs: per-pass cooldowns and the daily candidate cap, made live-tunable
-- so breadth/cost can be adjusted without a deploy. Additive ADD COLUMN only (no index build),
-- safe on Railway's managed Postgres. Defaults match the calibrated phase-1 values.
ALTER TABLE "Settings" ADD COLUMN "dailyMarketCap" INTEGER NOT NULL DEFAULT 3200;
ALTER TABLE "Settings" ADD COLUMN "verifierCooldownHours" INTEGER NOT NULL DEFAULT 144;
ALTER TABLE "Settings" ADD COLUMN "obviousCooldownHours" INTEGER NOT NULL DEFAULT 48;
