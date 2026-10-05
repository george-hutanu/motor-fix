-- AlterTable
ALTER TABLE "notification_preference" ADD COLUMN     "consent_given_at" TIMESTAMPTZ(3),
ADD COLUMN     "consent_source" TEXT,
ADD COLUMN     "consent_text_version" TEXT,
ADD COLUMN     "withdrawn_at" TIMESTAMPTZ(3);

-- No consent text was shown before this migration, so no NEWS row has consent.
UPDATE "notification_preference" SET "enabled" = false WHERE "type" = 'NEWS';

-- CreateTable
CREATE TABLE "news_send" (
    "month" TEXT NOT NULL,
    "sent_by_id" UUID NOT NULL,
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_send_pkey" PRIMARY KEY ("month")
);
