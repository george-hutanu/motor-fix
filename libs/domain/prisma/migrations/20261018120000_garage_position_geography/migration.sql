-- Each garage's position as a geography the area reads can index, kept from
-- latitude and longitude by a trigger, so it never drifts from them. A plain
-- column, not a generated one, so the Prisma schema can declare it and a
-- schema diff leaves it and its index alone.
CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE "garage" ADD COLUMN "position" geography(Point, 4326);

CREATE FUNCTION "garage_position_keep"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."position" := CASE
    WHEN NEW."latitude" IS NULL OR NEW."longitude" IS NULL THEN NULL
    ELSE ST_SetSRID(ST_MakePoint(NEW."longitude", NEW."latitude"), 4326)::geography
  END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "garage_position_keep"
  BEFORE INSERT OR UPDATE OF "latitude", "longitude" ON "garage"
  FOR EACH ROW EXECUTE FUNCTION "garage_position_keep"();

UPDATE "garage"
SET "position" = ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)::geography
WHERE "latitude" IS NOT NULL AND "longitude" IS NOT NULL;

CREATE INDEX "garage_position_idx" ON "garage" USING GIST ("position");
