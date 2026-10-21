-- AlterTable
ALTER TABLE "listing_draft" ADD COLUMN     "submit_key" VARCHAR(64),
ADD COLUMN     "submit_result" JSONB,
ADD COLUMN     "submitted_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "verification_file" ADD COLUMN     "cui_warning" TEXT;
