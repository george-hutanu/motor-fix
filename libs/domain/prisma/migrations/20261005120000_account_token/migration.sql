-- CreateEnum
CREATE TYPE "account_token_purpose" AS ENUM ('email_confirm');

-- CreateTable
CREATE TABLE "account_token" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "purpose" "account_token_purpose" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_token_token_hash_key" ON "account_token"("token_hash");

-- CreateIndex
CREATE INDEX "account_token_account_id_purpose_idx" ON "account_token"("account_id", "purpose");

-- AddForeignKey
ALTER TABLE "account_token" ADD CONSTRAINT "account_token_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
