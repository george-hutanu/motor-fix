-- The day's funnel on the whole-country row, written the next night by the
-- snapshot job; null on city rows and on a day not yet closed.
ALTER TABLE "platform_daily"
  ADD COLUMN "requests_quoted" INTEGER,
  ADD COLUMN "requests_accepted" INTEGER,
  ADD COLUMN "bookings_confirmed" INTEGER,
  ADD COLUMN "jobs_done" INTEGER,
  ADD COLUMN "reviews_posted" INTEGER,
  ADD CONSTRAINT "platform_daily_requests_quoted_min" CHECK ("requests_quoted" IS NULL OR "requests_quoted" >= 0),
  ADD CONSTRAINT "platform_daily_requests_accepted_min" CHECK ("requests_accepted" IS NULL OR "requests_accepted" >= 0),
  ADD CONSTRAINT "platform_daily_bookings_confirmed_min" CHECK ("bookings_confirmed" IS NULL OR "bookings_confirmed" >= 0),
  ADD CONSTRAINT "platform_daily_jobs_done_min" CHECK ("jobs_done" IS NULL OR "jobs_done" >= 0),
  ADD CONSTRAINT "platform_daily_reviews_posted_min" CHECK ("reviews_posted" IS NULL OR "reviews_posted" >= 0);
