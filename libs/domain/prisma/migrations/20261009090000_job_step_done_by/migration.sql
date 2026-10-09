-- AlterTable: who ticked a step, and the add's Idempotency-Key.
ALTER TABLE "job_step"
  ADD COLUMN "done_by" UUID,
  ADD COLUMN "idempotency_key" TEXT,
  ADD CONSTRAINT "job_step_done_by_fkey"
    FOREIGN KEY ("done_by") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "job_step_done_by_with_done_at"
    CHECK ("done_by" IS NULL OR "done_at" IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "job_step_job_id_idempotency_key_key" ON "job_step"("job_id", "idempotency_key");
