CREATE TABLE "garage_survey" (
    "garage_id" UUID NOT NULL,
    "mechanics_count" TEXT NOT NULL,
    "lifts_count" TEXT NOT NULL,
    "wants_live_media" BOOLEAN NOT NULL,
    "wants_day_sheets" BOOLEAN NOT NULL,
    "found_via" TEXT NOT NULL,
    "answered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "garage_survey_pkey" PRIMARY KEY ("garage_id"),
    CONSTRAINT "garage_survey_mechanics_count_check" CHECK ("mechanics_count" IN ('0', '1-2', '3-5', '6+')),
    CONSTRAINT "garage_survey_lifts_count_check" CHECK ("lifts_count" IN ('0', '1', '2-3', '4+')),
    CONSTRAINT "garage_survey_found_via_check" CHECK ("found_via" IN ('google', 'client', 'garage', 'social', 'other'))
);

ALTER TABLE "garage_survey" ADD CONSTRAINT "garage_survey_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
