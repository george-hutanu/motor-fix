-- CreateEnum
CREATE TYPE "garage_status" AS ENUM ('draft', 'approved', 'suspended');

-- CreateEnum
CREATE TYPE "verification_file_status" AS ENUM ('submitted', 'in_review', 'approved', 'more_requested', 'rejected');

-- AlterTable: a text-to-enum cast needs USING; every existing row is a draft.
ALTER TABLE "garage"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "garage_status" USING "status"::"garage_status",
  ALTER COLUMN "status" SET DEFAULT 'draft',
  ADD COLUMN "approved_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "verification_file" (
    "id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "status" "verification_file_status" NOT NULL DEFAULT 'submitted',
    "opened_by" UUID,
    "opened_at" TIMESTAMPTZ(3),
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "reopened_by" UUID,
    "reopened_at" TIMESTAMPTZ(3),
    "previous_file_id" UUID,
    "reason_code" TEXT,
    "reason_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_file_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "verification_file_previous_file_id_key" ON "verification_file"("previous_file_id");

-- CreateIndex
CREATE INDEX "verification_file_garage_id_created_at_idx" ON "verification_file"("garage_id", "created_at");

-- One live file per garage; Prisma's schema cannot express a partial index.
CREATE UNIQUE INDEX "verification_file_one_live" ON "verification_file"("garage_id") WHERE "status" IN ('submitted', 'in_review', 'approved');

-- AddForeignKey
ALTER TABLE "verification_file" ADD CONSTRAINT "verification_file_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_file" ADD CONSTRAINT "verification_file_previous_file_id_fkey" FOREIGN KEY ("previous_file_id") REFERENCES "verification_file"("id") ON DELETE SET NULL ON UPDATE CASCADE;
