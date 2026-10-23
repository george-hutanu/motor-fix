-- AlterTable
ALTER TABLE "mechanic" ADD COLUMN "rating" DECIMAL(2,1),
ADD COLUMN "review_count" INTEGER NOT NULL DEFAULT 0;

-- The garage's rules: 1.0 to 5.0, a count of 0 or more, and a rating exactly
-- when reviewed.
ALTER TABLE "mechanic"
  ADD CONSTRAINT "mechanic_rating_range" CHECK ("rating" BETWEEN 1.0 AND 5.0),
  ADD CONSTRAINT "mechanic_review_count_min" CHECK ("review_count" >= 0),
  ADD CONSTRAINT "mechanic_rating_reviewed" CHECK (("rating" IS NULL) = ("review_count" = 0));

-- CreateIndex
CREATE INDEX "review_mechanic_id_idx" ON "review"("mechanic_id");
