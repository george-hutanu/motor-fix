-- CreateEnum
CREATE TYPE "review_reply_status" AS ENUM ('published', 'reported', 'removed');

-- CreateEnum
CREATE TYPE "review_reply_removed_cause" AS ENUM ('report_upheld');

-- CreateTable
CREATE TABLE "review_reply" (
    "id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "posted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "posted_by" UUID,
    "edited_at" TIMESTAMPTZ(3),
    "status" "review_reply_status" NOT NULL DEFAULT 'published',
    "removed_at" TIMESTAMPTZ(3),
    "removed_cause" "review_reply_removed_cause",

    CONSTRAINT "review_reply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "review_reply_review_id_key" ON "review_reply"("review_id");

-- AddForeignKey
ALTER TABLE "review_reply" ADD CONSTRAINT "review_reply_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_reply" ADD CONSTRAINT "review_reply_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_reply" ADD CONSTRAINT "review_reply_posted_by_fkey" FOREIGN KEY ("posted_by") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
