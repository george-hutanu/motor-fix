-- The searches of each brand beside its requests: 0 on job rows, the day's
-- searches on the total row. A search is one search_log row, read by the
-- brand's name as it stood when the day was written.
ALTER TABLE "demand_daily"
    ADD COLUMN "searches" INTEGER NOT NULL DEFAULT 0,
    ADD CONSTRAINT "demand_daily_searches_min" CHECK ("searches" >= 0);

-- The demand view counts a window of days from the log.
CREATE INDEX "search_log_at_idx" ON "search_log"("at");

-- backfill
-- Days written before this column existed get their searches, so a written
-- day reads the same as one written from now on. A brand searched but never
-- requested that day gets its own row with 0 requests. Days without a total
-- row are not written yet and are counted live. Safe to run again.
INSERT INTO "demand_daily" ("day", "dimension", "key", "requests", "searches", "written_at")
SELECT t."day", 'brand', b."name", 0, count(*)::integer, t."written_at"
FROM "search_log" s
JOIN "brand" b ON b."id" = s."brand_id"
JOIN "demand_daily" t
  ON t."dimension" = 'total'
 AND t."key" = 'all'
 AND t."day" = (s."at" AT TIME ZONE 'Europe/Bucharest')::date
GROUP BY t."day", t."written_at", b."name"
ON CONFLICT ("day", "dimension", "key") DO UPDATE SET "searches" = EXCLUDED."searches";

UPDATE "demand_daily" t
SET "searches" = COALESCE((
    SELECT sum(b."searches")::integer
    FROM "demand_daily" b
    WHERE b."day" = t."day" AND b."dimension" = 'brand'
), 0)
WHERE t."dimension" = 'total' AND t."key" = 'all';
