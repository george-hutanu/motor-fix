-- AlterTable: an admin's decision on a proposed catalogue job.
ALTER TABLE "job_type" ADD COLUMN "decided_at" TIMESTAMPTZ(3),
ADD COLUMN "decided_by" UUID,
ADD COLUMN "rejection_reason" VARCHAR(500);

-- A reason only on a rejected job.
ALTER TABLE "job_type"
  ADD CONSTRAINT "job_type_rejection_reason_rejected"
  CHECK ("rejection_reason" IS NULL OR "status" = 'rejected');

-- AddForeignKey
ALTER TABLE "job_type" ADD CONSTRAINT "job_type_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
