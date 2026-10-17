-- Each garage's position as a geography the area reads can index; derived
-- from latitude and longitude, so it never drifts from them. Read only in
-- raw SQL: the Prisma schema does not declare it.
CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE "garage"
  ADD COLUMN "position" geography(Point, 4326)
  GENERATED ALWAYS AS (
    CASE WHEN "latitude" IS NULL OR "longitude" IS NULL THEN NULL
         ELSE ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)::geography
    END
  ) STORED;

CREATE INDEX "garage_position_idx" ON "garage" USING GIST ("position");
