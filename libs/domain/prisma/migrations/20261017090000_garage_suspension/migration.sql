-- CreateEnum
CREATE TYPE "garage_suspension_cause" AS ENUM ('recheck_failed', 'documents_overdue', 'admin', 'report_confirmed');

-- CreateTable
CREATE TABLE "garage_suspension" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "garage_id" UUID NOT NULL,
    "cause" "garage_suspension_cause" NOT NULL,
    "reason" TEXT NOT NULL,
    "from_time" TIMESTAMPTZ(3) NOT NULL,
    "until_time" TIMESTAMPTZ(3),
    "suspended_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "garage_suspension_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "garage_suspension_garage_id_from_time_idx" ON "garage_suspension"("garage_id", "from_time");

-- AddForeignKey
ALTER TABLE "garage_suspension" ADD CONSTRAINT "garage_suspension_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma cannot express these two: the reason the form allows, and one open
-- suspension per garage.
ALTER TABLE "garage_suspension" ADD CONSTRAINT "garage_suspension_reason_length"
  CHECK (char_length(btrim("reason")) BETWEEN 1 AND 200);

CREATE UNIQUE INDEX "garage_suspension_open_key"
  ON "garage_suspension"("garage_id") WHERE "until_time" IS NULL;
