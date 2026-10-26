-- CreateEnum
CREATE TYPE "live_stop_reason" AS ENUM ('job_closed', 'feature_off');

-- CreateEnum
CREATE TYPE "live_provider" AS ENUM ('cloudflare', 'fake');

-- CreateTable
CREATE TABLE "live_session" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "started_by" UUID,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stopped_at" TIMESTAMPTZ(3),
    "stop_reason" "live_stop_reason",
    "provider" "live_provider" NOT NULL,
    "provider_input_id" TEXT NOT NULL,

    CONSTRAINT "live_session_pkey" PRIMARY KEY ("id")
);

-- One live session per job; Prisma's schema cannot express a partial index.
CREATE UNIQUE INDEX "live_session_one_live" ON "live_session"("job_id") WHERE "stopped_at" IS NULL;

-- CreateIndex
CREATE INDEX "live_session_garage_id_idx" ON "live_session"("garage_id");

-- CreateIndex
CREATE INDEX "live_session_job_id_idx" ON "live_session"("job_id");

-- AddForeignKey
ALTER TABLE "live_session" ADD CONSTRAINT "live_session_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_session" ADD CONSTRAINT "live_session_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_session" ADD CONSTRAINT "live_session_started_by_fkey" FOREIGN KEY ("started_by") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
