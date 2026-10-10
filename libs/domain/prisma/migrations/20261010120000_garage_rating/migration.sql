-- A garage's rating and review count, read by Home's dial and the profile.
-- No route writes them yet; existing rows take NULL and 0.
ALTER TABLE "garage"
  ADD COLUMN "rating" NUMERIC(2,1),
  ADD COLUMN "review_count" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "garage_rating_range" CHECK ("rating" BETWEEN 1.0 AND 5.0),
  ADD CONSTRAINT "garage_review_count_min" CHECK ("review_count" >= 0),
  ADD CONSTRAINT "garage_rating_reviewed" CHECK (("rating" IS NULL) = ("review_count" = 0));
