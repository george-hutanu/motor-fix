
-- CreateEnum
CREATE TYPE "system_log_kind" AS ENUM ('status_changed', 'check_failed', 'job_failed', 'service_error', 'server_error', 'backup_completed', 'backup_failed', 'deploy');

-- CreateEnum
CREATE TYPE "system_log_source" AS ENUM ('api', 'search', 'maps', 'email', 'notifications', 'backup', 'worker', 'webrtc', 'identity', 'storage');

-- CreateEnum
CREATE TYPE "system_log_severity" AS ENUM ('info', 'warning', 'error');

-- CreateTable
CREATE TABLE "system_log_entry" (
    "id" UUID NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "minute" TIMESTAMPTZ(3) NOT NULL,
    "kind" "system_log_kind" NOT NULL,
    "source" "system_log_source" NOT NULL,
    "severity" "system_log_severity" NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB NOT NULL DEFAULT '{}',
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "system_log_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "system_log_entry_at_idx" ON "system_log_entry"("at" DESC);

-- CreateIndex
CREATE INDEX "system_log_entry_kind_at_idx" ON "system_log_entry"("kind", "at");

-- CreateIndex
CREATE INDEX "system_log_entry_message_trgm_idx" ON "system_log_entry" USING GIN ("message" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "system_log_entry_group_key" ON "system_log_entry"("kind", "source", "fingerprint", "minute");

