-- Each garage's distinct profile visitors per Europe/Bucharest day, written by
-- the night job from the live counters in Redis.
CREATE TABLE "garage_daily_figures" (
    "garage_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "profile_views" INTEGER NOT NULL,
    "profile_views_by_source" JSONB NOT NULL DEFAULT '{}',
    "written_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "garage_daily_figures_pkey" PRIMARY KEY ("garage_id", "day"),
    CONSTRAINT "garage_daily_figures_profile_views_min" CHECK ("profile_views" >= 0)
);

ALTER TABLE "garage_daily_figures" ADD CONSTRAINT "garage_daily_figures_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
