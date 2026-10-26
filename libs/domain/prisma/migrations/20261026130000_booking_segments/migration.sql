-- Whether a job is done on a lift: the confirm dialog offers one first.
ALTER TABLE "job_type" ADD COLUMN "needs_lift" BOOLEAN NOT NULL DEFAULT false;
UPDATE "job_type" SET "needs_lift" = true
WHERE "key" IN ('oil-service', 'front-brakes', 'timing-chain', 'suspension-alignment');

-- The places a confirmed booking holds, one row per working stretch it fills.
-- A segment's span is [starts_at, ends_at): one that starts as another ends
-- does not overlap it.
CREATE TABLE "booking_segment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "mechanic_id" UUID,
    "lift" INTEGER,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "booking_segment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "booking_segment_order_check" CHECK ("ends_at" > "starts_at")
);

CREATE INDEX "booking_segment_booking_id_idx" ON "booking_segment"("booking_id");
CREATE INDEX "booking_segment_garage_id_starts_at_idx" ON "booking_segment"("garage_id", "starts_at");

ALTER TABLE "booking_segment" ADD CONSTRAINT "booking_segment_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_segment" ADD CONSTRAINT "booking_segment_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_segment" ADD CONSTRAINT "booking_segment_mechanic_id_fkey" FOREIGN KEY ("mechanic_id") REFERENCES "mechanic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- backfill
-- Every confirmed booking holds its one span as a segment, on its mechanic
-- and lift; the others hold none. A booking that has its segments already
-- is left as it is.
INSERT INTO "booking_segment" ("booking_id", "garage_id", "mechanic_id", "lift", "starts_at", "ends_at")
SELECT b."id", b."garage_id", b."mechanic_id", b."lift", b."starts_at",
       b."starts_at" + make_interval(mins => b."duration_minutes")
FROM "booking" b
WHERE b."status" = 'confirmed'
  AND NOT EXISTS (SELECT 1 FROM "booking_segment" s WHERE s."booking_id" = b."id");
-- end backfill

ALTER TABLE "booking_segment" ADD CONSTRAINT "booking_segment_mechanic_excl"
  EXCLUDE USING gist ("mechanic_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&)
  WHERE ("mechanic_id" IS NOT NULL);

ALTER TABLE "booking_segment" ADD CONSTRAINT "booking_segment_lift_excl"
  EXCLUDE USING gist ("garage_id" WITH =, "lift" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&)
  WHERE ("lift" IS NOT NULL);

-- The overlap rules move from the booking to its segments.
ALTER TABLE "booking" DROP CONSTRAINT "booking_mechanic_span_excl";
ALTER TABLE "booking" DROP CONSTRAINT "booking_lift_span_excl";
