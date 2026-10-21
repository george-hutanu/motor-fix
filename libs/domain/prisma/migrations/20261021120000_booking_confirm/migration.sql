-- A garage's lifts, numbered 1..lift_count on a confirmed booking, and the
-- two rules that keep a mechanic and a lift from two confirmed bookings at
-- once. A booking's span is [starts_at, starts_at + duration_minutes): one
-- that starts as another ends does not overlap it.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "garage" ADD COLUMN "lift_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "garage" ADD CONSTRAINT "garage_lift_count_check" CHECK ("lift_count" >= 0);

-- Adding minutes to a timestamptz does not depend on the time zone, so the
-- span may be indexed although the operator is only marked stable.
CREATE FUNCTION "booking_span"(starts_at timestamptz, minutes integer) RETURNS tstzrange
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT tstzrange(starts_at, starts_at + make_interval(mins => minutes), '[)') $$;

ALTER TABLE "booking" ADD CONSTRAINT "booking_mechanic_span_excl"
  EXCLUDE USING gist ("mechanic_id" WITH =, "booking_span"("starts_at", "duration_minutes") WITH &&)
  WHERE ("status" = 'confirmed' AND "mechanic_id" IS NOT NULL);

ALTER TABLE "booking" ADD CONSTRAINT "booking_lift_span_excl"
  EXCLUDE USING gist ("garage_id" WITH =, "lift" WITH =, "booking_span"("starts_at", "duration_minutes") WITH &&)
  WHERE ("status" = 'confirmed' AND "lift" IS NOT NULL);

-- backfill
-- The lift count the owner gave in the sign-up survey: a range counts as its
-- lower end, no survey as none.
UPDATE "garage" g
SET "lift_count" = CASE s."lifts_count"
  WHEN '1' THEN 1
  WHEN '2-3' THEN 2
  WHEN '4+' THEN 4
  ELSE 0
END
FROM "garage_survey" s
WHERE s."garage_id" = g."id";
