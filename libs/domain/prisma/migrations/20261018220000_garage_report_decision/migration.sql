-- AlterEnum
ALTER TYPE "garage_report_status" ADD VALUE 'unfounded';
ALTER TYPE "garage_report_status" ADD VALUE 'confirmed';

-- AlterTable
ALTER TABLE "garage_report" ADD COLUMN "decided_by" UUID,
ADD COLUMN "decided_at" TIMESTAMPTZ(3),
ADD COLUMN "decision_note" TEXT;
