-- CreateEnum
CREATE TYPE "verification_reopen_reason" AS ENUM ('garage_report');

-- CreateEnum
CREATE TYPE "garage_report_status" AS ENUM ('open');

-- AlterTable
ALTER TABLE "verification_file" ADD COLUMN "reopen_reason" "verification_reopen_reason";

-- CreateTable
CREATE TABLE "garage_report" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "garage_id" UUID NOT NULL,
    "verification_file_id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "status" "garage_report_status" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "garage_report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "garage_report_verification_file_id_idx" ON "garage_report"("verification_file_id");

-- CreateIndex
CREATE INDEX "garage_report_reporter_id_created_at_idx" ON "garage_report"("reporter_id", "created_at");

-- AddForeignKey
ALTER TABLE "garage_report" ADD CONSTRAINT "garage_report_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garage_report" ADD CONSTRAINT "garage_report_verification_file_id_fkey" FOREIGN KEY ("verification_file_id") REFERENCES "verification_file"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garage_report" ADD CONSTRAINT "garage_report_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma cannot express these two: the text the form allows, and one open
-- report per driver and garage.
ALTER TABLE "garage_report" ADD CONSTRAINT "garage_report_text_length"
  CHECK (char_length("text") BETWEEN 20 AND 1000);

CREATE UNIQUE INDEX "garage_report_reporter_open_key"
  ON "garage_report"("reporter_id", "garage_id") WHERE "status" = 'open';
