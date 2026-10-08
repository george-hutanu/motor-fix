-- AlterTable: the place of step 5. A mobile mechanic's seat_address is never public.
ALTER TABLE "garage"
  ADD COLUMN "address" VARCHAR(200),
  ADD COLUMN "seat_address" VARCHAR(200),
  ADD COLUMN "latitude" DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION,
  ADD COLUMN "service_radius_km" SMALLINT,
  ADD CONSTRAINT "garage_address_length"
    CHECK ("address" IS NULL OR char_length("address") BETWEEN 1 AND 200),
  ADD CONSTRAINT "garage_seat_address_length"
    CHECK ("seat_address" IS NULL OR char_length("seat_address") BETWEEN 1 AND 200),
  ADD CONSTRAINT "garage_address_or_seat"
    CHECK ("address" IS NULL OR "seat_address" IS NULL),
  ADD CONSTRAINT "garage_position_both_or_neither"
    CHECK (("latitude" IS NULL) = ("longitude" IS NULL)),
  -- The earth's ranges only: Romania's box lives in the contracts library alone.
  ADD CONSTRAINT "garage_position_range"
    CHECK ("latitude" IS NULL OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)),
  ADD CONSTRAINT "garage_service_radius_range"
    CHECK ("service_radius_km" IS NULL OR "service_radius_km" BETWEEN 1 AND 100);
