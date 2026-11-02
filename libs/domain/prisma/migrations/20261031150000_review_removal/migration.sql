-- An admin removes a reported review, or its garage's reply: who, when and
-- which rule on the review; review_removed for a reply that goes with it.
ALTER TYPE "review_reply_removed_cause" ADD VALUE 'review_removed';

ALTER TABLE "review"
  ADD COLUMN "removed_by" UUID,
  ADD COLUMN "removed_at" TIMESTAMPTZ(3),
  ADD COLUMN "removal_reason" "review_report_reason";

ALTER TABLE "review"
  ADD CONSTRAINT "review_removed_by_fkey" FOREIGN KEY ("removed_by")
  REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
