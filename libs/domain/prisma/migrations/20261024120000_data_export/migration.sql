-- The copies of their data that people ask for.

-- CreateEnum
CREATE TYPE "data_export_status" AS ENUM ('queued', 'ready', 'expired', 'failed');

-- CreateTable
CREATE TABLE "data_export" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "data_export_status" NOT NULL DEFAULT 'queued',
    "zip_key" TEXT,
    "ready_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "data_export_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "data_export_account_id_requested_at_idx" ON "data_export"("account_id", "requested_at" DESC);

-- CreateIndex
CREATE INDEX "data_export_status_expires_at_idx" ON "data_export"("status", "expires_at");

-- One build at a time per account: the loser of two simultaneous requests
-- fails its insert here.
CREATE UNIQUE INDEX "data_export_one_queued" ON "data_export"("account_id") WHERE "status" = 'queued';

-- AddForeignKey
ALTER TABLE "data_export" ADD CONSTRAINT "data_export_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
