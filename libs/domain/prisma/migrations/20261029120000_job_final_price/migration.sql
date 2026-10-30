-- Who recorded a job's final price at the handover, and when it was last corrected.
ALTER TABLE "job"
  ADD COLUMN "final_price_recorded_by" UUID,
  ADD COLUMN "final_price_corrected_at" TIMESTAMPTZ(3),
  ADD CONSTRAINT "job_final_price_recorded_by_fkey" FOREIGN KEY ("final_price_recorded_by") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
