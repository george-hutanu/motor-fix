-- The messages sent through the contact form, and the yearly counter
-- behind their references.

-- CreateEnum
CREATE TYPE "support_sender_role" AS ENUM ('visitor', 'driver', 'garage', 'admin');

-- CreateEnum
CREATE TYPE "support_topic" AS ENUM ('request_or_booking', 'account', 'reviews', 'listing', 'other');

-- CreateEnum
CREATE TYPE "support_email_status" AS ENUM ('pending', 'sent', 'blocked', 'unconfigured');

-- CreateTable
CREATE TABLE "support_message" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reference" TEXT NOT NULL,
    "account_id" UUID,
    "role" "support_sender_role" NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "topic" "support_topic" NOT NULL,
    "message" TEXT NOT NULL,
    "subject_ref" TEXT,
    "language" TEXT NOT NULL,
    "support_email_status" "support_email_status" NOT NULL DEFAULT 'pending',
    "support_email_at" TIMESTAMPTZ(3),
    "acknowledgement_status" "support_email_status" NOT NULL DEFAULT 'pending',
    "acknowledgement_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_message_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "support_message_name_length" CHECK (char_length("name") BETWEEN 1 AND 80),
    CONSTRAINT "support_message_email_length" CHECK (char_length("email") BETWEEN 3 AND 254),
    CONSTRAINT "support_message_message_length" CHECK (char_length("message") BETWEEN 20 AND 2000),
    CONSTRAINT "support_message_subject_ref_length" CHECK ("subject_ref" IS NULL OR char_length("subject_ref") <= 40),
    CONSTRAINT "support_message_language" CHECK ("language" IN ('ro', 'en')),
    -- Only the support e-mail waits for an address; the sender's never does.
    CONSTRAINT "support_message_acknowledgement_configured" CHECK ("acknowledgement_status" <> 'unconfigured')
);

-- CreateTable
CREATE TABLE "support_reference" (
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL,

    CONSTRAINT "support_reference_pkey" PRIMARY KEY ("year")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_message_reference_key" ON "support_message"("reference");

-- CreateIndex
CREATE INDEX "support_message_account_id_idx" ON "support_message"("account_id");

-- The unsent gauge and the requeue read only the messages still waiting.
CREATE INDEX "support_message_unsent_idx" ON "support_message"("created_at")
    WHERE "support_email_status" IN ('pending', 'unconfigured')
       OR "acknowledgement_status" = 'pending';

-- AddForeignKey
ALTER TABLE "support_message" ADD CONSTRAINT "support_message_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
