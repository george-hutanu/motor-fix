-- The areas the admin's demand and supply report counts by: the six sectors
-- of București and the county seats, each with its outline. Loaded from the
-- data file by code when the API starts; never deleted here.
CREATE TABLE "area" (
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "kind" VARCHAR(6) NOT NULL,
    "outline" geography(MultiPolygon, 4326) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "area_pkey" PRIMARY KEY ("code"),
    CONSTRAINT "area_kind_check" CHECK ("kind" IN ('city', 'sector'))
);

CREATE INDEX "area_outline_idx" ON "area" USING GIST ("outline");

-- The brand and area rows: dimension "brand_area" needs ten characters, and
-- each row counts the requests that expired that day without a quote.
ALTER TABLE "demand_daily" ALTER COLUMN "dimension" TYPE VARCHAR(10);

ALTER TABLE "demand_daily"
    ADD COLUMN "unmet_requests" INTEGER NOT NULL DEFAULT 0,
    ADD CONSTRAINT "demand_daily_unmet_requests_min" CHECK ("unmet_requests" >= 0);
