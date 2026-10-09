-- CreateTable
CREATE TABLE "garage_response_stats" (
    "garage_id" UUID NOT NULL,
    "requests_30d" INTEGER NOT NULL,
    "answered_within_day_30d" INTEGER NOT NULL,
    "lifetime_requests" INTEGER NOT NULL,
    "rate" INTEGER,
    "computed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "garage_response_stats_pkey" PRIMARY KEY ("garage_id"),
    CONSTRAINT "garage_response_stats_rate_check" CHECK ("rate" BETWEEN 0 AND 100)
);

-- AddForeignKey
ALTER TABLE "garage_response_stats" ADD CONSTRAINT "garage_response_stats_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
