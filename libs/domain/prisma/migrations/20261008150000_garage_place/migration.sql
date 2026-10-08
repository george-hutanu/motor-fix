-- AlterTable: the place of step 5. A mobile mechanic's seat_address is never public.
ALTER TABLE "garage"
  ADD COLUMN "address" VARCHAR(200),
  ADD COLUMN "seat_address" VARCHAR(200),
  ADD COLUMN "latitude" DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION,
  ADD COLUMN "service_radius_km" SMALLINT,
  ADD CONSTRAINT "garage_position_both_or_neither"
    CHECK (("latitude" IS NULL) = ("longitude" IS NULL)),
  ADD CONSTRAINT "garage_position_in_romania"
    CHECK ("latitude" IS NULL OR ("latitude" BETWEEN 43.5 AND 48.4 AND "longitude" BETWEEN 20.2 AND 29.8)),
  ADD CONSTRAINT "garage_service_radius_range"
    CHECK ("service_radius_km" IS NULL OR "service_radius_km" BETWEEN 1 AND 100);
