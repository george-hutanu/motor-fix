-- What drivers asked for per Europe/Bucharest day, written by the night job:
-- one row per car brand and per job type with a request that day, and one
-- total row, kept even when it is 0. Keys are names, not references, so a
-- renamed or removed catalogue row never rewrites a past day.
CREATE TABLE "demand_daily" (
    "day" DATE NOT NULL,
    "dimension" VARCHAR(8) NOT NULL,
    "key" TEXT NOT NULL,
    "requests" INTEGER NOT NULL,
    "written_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "demand_daily_pkey" PRIMARY KEY ("day", "dimension", "key"),
    CONSTRAINT "demand_daily_requests_min" CHECK ("requests" >= 0)
);
