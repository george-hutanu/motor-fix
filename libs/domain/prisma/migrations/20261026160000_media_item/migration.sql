-- CreateEnum
CREATE TYPE "media_kind" AS ENUM ('photo', 'clip', 'live');

-- CreateEnum
CREATE TYPE "media_status" AS ENUM ('processing', 'visible', 'failed', 'removed', 'purged');

-- CreateTable
CREATE TABLE "media_item" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "sender_id" UUID,
    "kind" "media_kind" NOT NULL,
    "status" "media_status" NOT NULL DEFAULT 'processing',
    "caption" VARCHAR(140),
    "content_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "original_key" TEXT,
    "file_key" TEXT,
    "thumbnail_key" TEXT,
    "provider_ref" TEXT,
    "seconds" INTEGER,
    "sent_at" TIMESTAMPTZ(3) NOT NULL,
    "uploaded_at" TIMESTAMPTZ(3),
    "purge_after" TIMESTAMPTZ(3) NOT NULL,
    "removed_at" TIMESTAMPTZ(3),
    "purged_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "media_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "media_item_job_id_sent_at_idx" ON "media_item"("job_id", "sent_at");

-- CreateIndex
CREATE INDEX "media_item_status_purge_after_idx" ON "media_item"("status", "purge_after");

-- AddForeignKey
ALTER TABLE "media_item" ADD CONSTRAINT "media_item_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_item" ADD CONSTRAINT "media_item_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_item" ADD CONSTRAINT "media_item_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
