-- CreateEnum
CREATE TYPE "listing_draft_status" AS ENUM ('open', 'submitted');

-- CreateEnum
CREATE TYPE "listing_draft_token_kind" AS ENUM ('browser', 'link', 'reminder');

-- CreateTable
CREATE TABLE "listing_draft" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "step" INTEGER NOT NULL,
    "language" "language" NOT NULL,
    "status" "listing_draft_status" NOT NULL DEFAULT 'open',
    "reminded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "listing_draft_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "listing_draft_step" CHECK ("step" BETWEEN 1 AND 6)
);

-- CreateTable
CREATE TABLE "listing_draft_token" (
    "hash" TEXT NOT NULL,
    "draft_id" UUID NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL,
    "kind" "listing_draft_token_kind" NOT NULL,

    CONSTRAINT "listing_draft_token_pkey" PRIMARY KEY ("hash")
);

-- AlterTable: a draft's e-mail has no account; a row has one recipient or the other.
ALTER TABLE "notification"
  ALTER COLUMN "account_id" DROP NOT NULL,
  ADD COLUMN "listing_draft_id" UUID,
  ADD CONSTRAINT "notification_one_recipient" CHECK (("account_id" IS NULL) <> ("listing_draft_id" IS NULL));

-- CreateIndex
CREATE INDEX "listing_draft_status_updated_at_idx" ON "listing_draft"("status", "updated_at");

-- CreateIndex
CREATE INDEX "listing_draft_token_draft_id_sent_at_idx" ON "listing_draft_token"("draft_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_kind_listing_draft_id_channel_event_id_key" ON "notification"("kind", "listing_draft_id", "channel", "event_id");

-- CreateIndex
CREATE INDEX "notification_listing_draft_id_idx" ON "notification"("listing_draft_id");

-- AddForeignKey
ALTER TABLE "listing_draft_token" ADD CONSTRAINT "listing_draft_token_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "listing_draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_listing_draft_id_fkey" FOREIGN KEY ("listing_draft_id") REFERENCES "listing_draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
