-- CreateEnum
CREATE TYPE "booking_move_side" AS ENUM ('driver', 'garage');

-- CreateEnum
CREATE TYPE "booking_move_status" AS ENUM ('proposed', 'accepted', 'refused', 'lapsed', 'cancelled');

-- CreateEnum
CREATE TYPE "booking_move_refuse_reason" AS ENUM ('no_mechanic_free', 'parts_not_available', 'closed_that_day', 'other');

-- CreateTable
CREATE TABLE "booking_move" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "proposed_by_side" "booking_move_side" NOT NULL,
    "proposed_by" UUID NOT NULL,
    "new_starts_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "booking_move_status" NOT NULL DEFAULT 'proposed',
    "lapses_at" TIMESTAMPTZ(3) NOT NULL,
    "decided_at" TIMESTAMPTZ(3),
    "decided_by" UUID,
    "refuse_reason" "booking_move_refuse_reason",
    "idempotency_key" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_move_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "booking_move_status_lapses_at_idx" ON "booking_move"("status", "lapses_at");

-- CreateIndex
CREATE INDEX "booking_move_booking_id_created_at_idx" ON "booking_move"("booking_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "booking_move_proposed_by_idempotency_key_key" ON "booking_move"("proposed_by", "idempotency_key");

-- AddForeignKey
ALTER TABLE "booking_move" ADD CONSTRAINT "booking_move_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_move" ADD CONSTRAINT "booking_move_proposed_by_fkey" FOREIGN KEY ("proposed_by") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_move" ADD CONSTRAINT "booking_move_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- One waiting ask per booking, whichever side asked.
CREATE UNIQUE INDEX "booking_move_one_proposed" ON "booking_move"("booking_id") WHERE "status" = 'proposed';

-- A refusal always names its reason, and only a refusal does.
ALTER TABLE "booking_move" ADD CONSTRAINT "booking_move_refuse_reason_check" CHECK (("status" = 'refused') = ("refuse_reason" IS NOT NULL));

-- An Idempotency-Key is one to 200 characters, as the API accepts it.
ALTER TABLE "booking_move" ADD CONSTRAINT "booking_move_idempotency_key_length" CHECK (char_length("idempotency_key") >= 1);
