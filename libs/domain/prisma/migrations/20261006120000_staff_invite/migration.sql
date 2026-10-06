-- CreateEnum
CREATE TYPE "staff_invite_kind" AS ENUM ('mechanic', 'receptionist');

-- CreateEnum
CREATE TYPE "staff_invite_status" AS ENUM ('sent', 'accepted', 'revoked');

-- CreateTable
CREATE TABLE "staff_invite" (
    "id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "kind" "staff_invite_kind" NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "can_move_bookings" BOOLEAN NOT NULL DEFAULT false,
    "can_answer_quotes" BOOLEAN NOT NULL DEFAULT false,
    "can_record_final_price" BOOLEAN NOT NULL DEFAULT false,
    "token_hash" TEXT NOT NULL,
    "status" "staff_invite_status" NOT NULL DEFAULT 'sent',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_invite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_invite_token_hash_key" ON "staff_invite"("token_hash");

-- CreateIndex
CREATE INDEX "staff_invite_garage_id_email_idx" ON "staff_invite"("garage_id", "email");

-- AddForeignKey
ALTER TABLE "staff_invite" ADD CONSTRAINT "staff_invite_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
