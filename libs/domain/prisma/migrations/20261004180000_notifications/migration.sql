-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('in_app', 'email', 'push', 'sms', 'whatsapp');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('queued', 'held', 'sent', 'failed');

-- AlterTable
ALTER TABLE "account" ADD COLUMN     "email_bounced_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "subject_id" UUID,
    "channel" "notification_channel" NOT NULL,
    "status" "notification_status" NOT NULL,
    "event_id" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "send_after" TIMESTAMPTZ(3),
    "group_leader_id" UUID,
    "sent_at" TIMESTAMPTZ(3),
    "read_at" TIMESTAMPTZ(3),
    "fallback_of" UUID,
    "failure" TEXT,
    "provider_message_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_account_id_created_at_idx" ON "notification"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_kind_account_id_channel_created_at_idx" ON "notification"("kind", "account_id", "channel", "created_at");

-- CreateIndex
CREATE INDEX "notification_provider_message_id_idx" ON "notification"("provider_message_id");

-- CreateIndex
CREATE INDEX "notification_group_leader_id_idx" ON "notification"("group_leader_id");

-- CreateIndex
CREATE INDEX "notification_fallback_of_idx" ON "notification"("fallback_of");

-- CreateIndex
CREATE UNIQUE INDEX "notification_kind_account_id_channel_event_id_key" ON "notification"("kind", "account_id", "channel", "event_id");

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_group_leader_id_fkey" FOREIGN KEY ("group_leader_id") REFERENCES "notification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_fallback_of_fkey" FOREIGN KEY ("fallback_of") REFERENCES "notification"("id") ON DELETE SET NULL ON UPDATE CASCADE;
