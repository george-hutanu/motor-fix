-- AI assistants: one grant per account and assistant client, the hashed
-- single-use sign-in codes the identity server exchanges, and the request id
-- of the call that wrote an activity entry (existing rows stay null).

-- AlterTable
ALTER TABLE "activity_log" ADD COLUMN     "request_id" TEXT;

-- CreateTable
CREATE TABLE "assistant_grant" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "account_id" UUID NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "can_read" BOOLEAN NOT NULL,
    "can_act" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by" TEXT,
    "revoke_reason" TEXT,

    CONSTRAINT "assistant_grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_sign_in_code" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code_hash" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "client_id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_sign_in_code_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assistant_grant_account_id_client_id_key" ON "assistant_grant"("account_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_sign_in_code_code_hash_key" ON "assistant_sign_in_code"("code_hash");

-- AddForeignKey
ALTER TABLE "assistant_grant" ADD CONSTRAINT "assistant_grant_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_sign_in_code" ADD CONSTRAINT "assistant_sign_in_code_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

