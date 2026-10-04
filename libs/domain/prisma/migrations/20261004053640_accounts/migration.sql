-- CreateEnum
CREATE TYPE "role" AS ENUM ('driver', 'garage', 'receptionist', 'mechanic', 'admin');

-- CreateEnum
CREATE TYPE "language" AS ENUM ('ro', 'en');

-- CreateEnum
CREATE TYPE "account_status" AS ENUM ('active', 'suspended', 'deleted');

-- CreateEnum
CREATE TYPE "sign_in_method" AS ENUM ('password', 'google', 'apple', 'whatsapp_phone');

-- CreateEnum
CREATE TYPE "garage_member_role" AS ENUM ('owner', 'receptionist');

-- CreateTable
CREATE TABLE "account" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "email_verified_at" TIMESTAMPTZ(3),
    "phone" TEXT,
    "phone_verified_at" TIMESTAMPTZ(3),
    "name" TEXT NOT NULL,
    "city" TEXT,
    "language" "language" NOT NULL DEFAULT 'ro',
    "status" "account_status" NOT NULL DEFAULT 'active',
    "last_role" "role" NOT NULL,
    "last_active_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_role" (
    "account_id" UUID NOT NULL,
    "role" "role" NOT NULL,

    CONSTRAINT "account_role_pkey" PRIMARY KEY ("account_id","role")
);

-- CreateTable
CREATE TABLE "account_identity" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "method" "sign_in_method" NOT NULL,
    "subject" TEXT NOT NULL,
    "password_hash" TEXT,

    CONSTRAINT "account_identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_token" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garage" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "garage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garage_member" (
    "garage_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "role" "garage_member_role" NOT NULL,
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "garage_member_pkey" PRIMARY KEY ("garage_id","account_id")
);

-- CreateTable
CREATE TABLE "mechanic" (
    "id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "can_move_bookings" BOOLEAN NOT NULL DEFAULT false,
    "can_answer_quotes" BOOLEAN NOT NULL DEFAULT false,
    "can_record_final_price" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "mechanic_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_email_key" ON "account"("email");

-- CreateIndex
CREATE UNIQUE INDEX "account_phone_key" ON "account"("phone");

-- CreateIndex
CREATE INDEX "account_identity_account_id_idx" ON "account_identity"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_identity_method_subject_key" ON "account_identity"("method", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_token_hash_key" ON "refresh_token"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_token_account_id_idx" ON "refresh_token"("account_id");

-- CreateIndex
CREATE INDEX "refresh_token_family_id_idx" ON "refresh_token"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "garage_slug_key" ON "garage"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "garage_member_account_id_role_key" ON "garage_member"("account_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "mechanic_account_id_key" ON "mechanic"("account_id");

-- CreateIndex
CREATE INDEX "mechanic_garage_id_idx" ON "mechanic"("garage_id");

-- AddForeignKey
ALTER TABLE "account_role" ADD CONSTRAINT "account_role_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_identity" ADD CONSTRAINT "account_identity_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garage_member" ADD CONSTRAINT "garage_member_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garage_member" ADD CONSTRAINT "garage_member_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mechanic" ADD CONSTRAINT "mechanic_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mechanic" ADD CONSTRAINT "mechanic_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
