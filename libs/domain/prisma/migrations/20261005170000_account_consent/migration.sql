-- CreateEnum
CREATE TYPE "consent_kind" AS ENUM ('terms', 'privacy_notice');

-- CreateTable
CREATE TABLE "account_consent" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "kind" "consent_kind" NOT NULL,
    "text_version" TEXT NOT NULL,
    "language" "language" NOT NULL,
    "method" "sign_in_method" NOT NULL,
    "accepted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_consent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_consent_account_id_idx" ON "account_consent"("account_id");

-- AddForeignKey
ALTER TABLE "account_consent" ADD CONSTRAINT "account_consent_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
