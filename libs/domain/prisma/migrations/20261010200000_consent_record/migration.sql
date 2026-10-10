-- CreateEnum
CREATE TYPE "consent_record_kind" AS ENUM ('analytics');

-- CreateEnum
CREATE TYPE "consent_decision" AS ENUM ('granted', 'refused', 'withdrawn');

-- CreateTable
CREATE TABLE "consent_record" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "browser_consent_id" UUID NOT NULL,
    "account_id" UUID,
    "kind" "consent_record_kind" NOT NULL,
    "decision" "consent_decision" NOT NULL,
    "text_version" TEXT NOT NULL,
    "language" "language" NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consent_record_account_id_at_idx" ON "consent_record"("account_id", "at" DESC);

-- AddForeignKey
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
