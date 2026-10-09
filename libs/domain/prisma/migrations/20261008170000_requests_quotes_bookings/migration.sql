-- CreateEnum
CREATE TYPE "quote_request_status" AS ENUM ('sent', 'quoted', 'booked', 'in_work', 'done', 'closed');

-- CreateEnum
CREATE TYPE "request_closed_reason" AS ENUM ('expired', 'cancelled', 'booking_lapsed', 'booking_cancelled', 'no_show', 'account_closed');

-- CreateEnum
CREATE TYPE "request_recipient_status" AS ENUM ('waiting', 'quoted', 'declined', 'expired', 'closed');

-- CreateEnum
CREATE TYPE "request_source" AS ENUM ('search', 'map', 'home', 'shared_link', 'profile_direct', 'saved', 'unknown');

-- CreateEnum
CREATE TYPE "decline_reason" AS ENUM ('fully_booked', 'job_not_done', 'make_model_engine_not_done', 'need_to_see_car');

-- CreateEnum
CREATE TYPE "quote_status" AS ENUM ('waiting', 'accepted', 'withdrawn', 'expired', 'lost', 'declined_by_driver');

-- CreateEnum
CREATE TYPE "booking_status" AS ENUM ('awaiting_confirmation', 'confirmed', 'lapsed', 'cancelled', 'no_show', 'completed');

-- CreateEnum
CREATE TYPE "cancelled_by_side" AS ENUM ('driver', 'garage', 'system');

-- CreateEnum
CREATE TYPE "booking_cancel_reason" AS ENUM ('plans_changed', 'found_another_garage', 'problem_solved', 'no_mechanic_free', 'parts_not_available', 'closed_that_day', 'driver_asked', 'other', 'garage_suspended', 'driver_account_closed');

-- CreateEnum
CREATE TYPE "job_status" AS ENUM ('to_do', 'in_work', 'paused', 'done', 'cancelled');

-- CreateTable
CREATE TABLE "quote_request" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "car_id" UUID NOT NULL,
    "car_brand" TEXT NOT NULL,
    "car_model" TEXT NOT NULL,
    "car_year" INTEGER NOT NULL,
    "car_fuel" "fuel" NOT NULL,
    "car_engine" TEXT,
    "description" TEXT,
    "status" "quote_request_status" NOT NULL DEFAULT 'sent',
    "closed_reason" "request_closed_reason",
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quote_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_job" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "job_type_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "request_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_recipient" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "status" "request_recipient_status" NOT NULL DEFAULT 'waiting',
    "source" "request_source" NOT NULL,
    "answered_at" TIMESTAMPTZ(3),
    "decline_reason" "decline_reason",
    "declined_at" TIMESTAMPTZ(3),
    "declined_by" UUID,
    "reminded_day2_at" TIMESTAMPTZ(3),
    "reminded_day5_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_recipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "from_bani" INTEGER NOT NULL,
    "to_bani" INTEGER NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "slot" TIMESTAMPTZ(3) NOT NULL,
    "note" TEXT,
    "status" "quote_status" NOT NULL DEFAULT 'waiting',
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_at" TIMESTAMPTZ(3),
    "withdrawn_at" TIMESTAMPTZ(3),
    "accepted_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_job" (
    "id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "request_job_id" UUID NOT NULL,
    "included" BOOLEAN NOT NULL,

    CONSTRAINT "quote_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking" (
    "id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "status" "booking_status" NOT NULL DEFAULT 'awaiting_confirmation',
    "confirm_by" TIMESTAMPTZ(3) NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3),
    "confirmed_by" UUID,
    "mechanic_id" UUID,
    "lift" INTEGER,
    "move_count" INTEGER NOT NULL DEFAULT 0,
    "history_shared" BOOLEAN NOT NULL DEFAULT false,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_side" "cancelled_by_side",
    "cancelled_by" UUID,
    "cancel_reason" "booking_cancel_reason",
    "cancel_note" TEXT,
    "late_cancellation" BOOLEAN NOT NULL DEFAULT false,
    "no_show_at" TIMESTAMPTZ(3),
    "no_show_recorded_by" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "car_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "mechanic_id" UUID,
    "status" "job_status" NOT NULL DEFAULT 'to_do',
    "started_at" TIMESTAMPTZ(3),
    "paused_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "handed_over_at" TIMESTAMPTZ(3),
    "eta_at" TIMESTAMPTZ(3),
    "final_price_bani" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_step" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "customer_label" TEXT,
    "done_at" TIMESTAMPTZ(3),

    CONSTRAINT "job_step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_stage_entry" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "from_status" "job_status",
    "to_status" "job_status" NOT NULL,
    "actor_id" UUID,
    "actor_role" "audit_actor_role" NOT NULL,
    "text" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_stage_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quote_request_driver_id_created_at_id_idx" ON "quote_request"("driver_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "request_job_request_id_job_type_id_key" ON "request_job"("request_id", "job_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "request_job_request_id_position_key" ON "request_job"("request_id", "position");

-- CreateIndex
CREATE INDEX "request_recipient_garage_id_created_at_idx" ON "request_recipient"("garage_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "request_recipient_request_id_garage_id_key" ON "request_recipient"("request_id", "garage_id");

-- CreateIndex
CREATE UNIQUE INDEX "quote_recipient_id_key" ON "quote"("recipient_id");

-- CreateIndex
CREATE INDEX "quote_garage_id_sent_at_idx" ON "quote"("garage_id", "sent_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "quote_request_id_garage_id_key" ON "quote"("request_id", "garage_id");

-- CreateIndex
CREATE UNIQUE INDEX "quote_job_quote_id_request_job_id_key" ON "quote_job"("quote_id", "request_job_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_quote_id_key" ON "booking"("quote_id");

-- CreateIndex
CREATE INDEX "booking_garage_id_created_at_idx" ON "booking"("garage_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "booking_request_id_idx" ON "booking"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_booking_id_key" ON "job"("booking_id");

-- CreateIndex
CREATE INDEX "job_garage_id_created_at_idx" ON "job"("garage_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "job_mechanic_id_idx" ON "job"("mechanic_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_step_job_id_position_key" ON "job_step"("job_id", "position");

-- CreateIndex
CREATE INDEX "job_stage_entry_job_id_at_idx" ON "job_stage_entry"("job_id", "at");

-- AddForeignKey
ALTER TABLE "quote_request" ADD CONSTRAINT "quote_request_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_request" ADD CONSTRAINT "quote_request_car_id_fkey" FOREIGN KEY ("car_id") REFERENCES "car"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_job" ADD CONSTRAINT "request_job_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "quote_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_job" ADD CONSTRAINT "request_job_job_type_id_fkey" FOREIGN KEY ("job_type_id") REFERENCES "job_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_recipient" ADD CONSTRAINT "request_recipient_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "quote_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_recipient" ADD CONSTRAINT "request_recipient_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_recipient" ADD CONSTRAINT "request_recipient_declined_by_fkey" FOREIGN KEY ("declined_by") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "quote_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "request_recipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_job" ADD CONSTRAINT "quote_job_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_job" ADD CONSTRAINT "quote_job_request_job_id_fkey" FOREIGN KEY ("request_job_id") REFERENCES "request_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "quote_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_no_show_recorded_by_fkey" FOREIGN KEY ("no_show_recorded_by") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_mechanic_id_fkey" FOREIGN KEY ("mechanic_id") REFERENCES "mechanic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_car_id_fkey" FOREIGN KEY ("car_id") REFERENCES "car"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_mechanic_id_fkey" FOREIGN KEY ("mechanic_id") REFERENCES "mechanic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_step" ADD CONSTRAINT "job_step_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_stage_entry" ADD CONSTRAINT "job_stage_entry_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_stage_entry" ADD CONSTRAINT "job_stage_entry_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The rules the database holds itself. A status and the columns it owns move
-- together; the transition tables in the domain decide which moves exist.
ALTER TABLE "quote_request"
  ADD CONSTRAINT "quote_request_description_length"
    CHECK ("description" IS NULL OR char_length("description") BETWEEN 1 AND 2000),
  ADD CONSTRAINT "quote_request_closed_check"
    CHECK (("status" = 'closed') = ("closed_reason" IS NOT NULL)
       AND ("status" = 'closed') = ("closed_at" IS NOT NULL));

ALTER TABLE "request_job"
  ADD CONSTRAINT "request_job_position_range" CHECK ("position" >= 0);

ALTER TABLE "request_recipient"
  ADD CONSTRAINT "request_recipient_declined_check"
    CHECK (("status" = 'declined') = ("decline_reason" IS NOT NULL)
       AND ("status" = 'declined') = ("declined_at" IS NOT NULL));

-- A quote is never sent without its range, duration and slot.
ALTER TABLE "quote"
  ADD CONSTRAINT "quote_range_check"
    CHECK ("from_bani" > 0 AND "to_bani" >= "from_bani"),
  ADD CONSTRAINT "quote_duration_check" CHECK ("duration_minutes" > 0),
  ADD CONSTRAINT "quote_note_length"
    CHECK ("note" IS NULL OR char_length("note") BETWEEN 1 AND 500);

-- One accepted quote per request; Prisma cannot write a partial index.
CREATE UNIQUE INDEX "quote_one_accepted_per_request"
  ON "quote" ("request_id") WHERE "status" = 'accepted';

-- The cancellation reasons per side are also in the domain's config, whose
-- spec compares the two lists.
ALTER TABLE "booking"
  ADD CONSTRAINT "booking_duration_check" CHECK ("duration_minutes" > 0),
  ADD CONSTRAINT "booking_lift_check" CHECK ("lift" IS NULL OR "lift" > 0),
  ADD CONSTRAINT "booking_move_count_check" CHECK ("move_count" >= 0),
  ADD CONSTRAINT "booking_cancel_note_length"
    CHECK ("cancel_note" IS NULL OR char_length("cancel_note") BETWEEN 1 AND 500),
  ADD CONSTRAINT "booking_cancelled_check"
    CHECK (("status" = 'cancelled') = ("cancelled_at" IS NOT NULL)
       AND ("status" = 'cancelled') = ("cancelled_by_side" IS NOT NULL)
       AND ("status" = 'cancelled') = ("cancel_reason" IS NOT NULL)),
  ADD CONSTRAINT "booking_cancel_reason_side_check"
    CHECK ("cancelled_by_side" IS NULL
       OR ("cancelled_by_side" = 'driver' AND "cancel_reason" IN ('plans_changed', 'found_another_garage', 'problem_solved', 'other'))
       OR ("cancelled_by_side" = 'garage' AND "cancel_reason" IN ('no_mechanic_free', 'parts_not_available', 'closed_that_day', 'driver_asked', 'other'))
       OR ("cancelled_by_side" = 'system' AND "cancel_reason" IN ('garage_suspended', 'driver_account_closed'))),
  ADD CONSTRAINT "booking_no_show_check"
    CHECK (("status" = 'no_show') = ("no_show_at" IS NOT NULL)),
  ADD CONSTRAINT "booking_completed_check"
    CHECK (("status" = 'completed') = ("completed_at" IS NOT NULL)),
  ADD CONSTRAINT "booking_confirmed_check"
    CHECK ("status" NOT IN ('confirmed', 'no_show', 'completed') OR "confirmed_at" IS NOT NULL);

ALTER TABLE "job"
  ADD CONSTRAINT "job_final_price_check"
    CHECK ("final_price_bani" IS NULL OR "final_price_bani" > 0);

ALTER TABLE "job_step"
  ADD CONSTRAINT "job_step_position_range" CHECK ("position" >= 0),
  ADD CONSTRAINT "job_step_label_length" CHECK (char_length("label") BETWEEN 1 AND 120),
  ADD CONSTRAINT "job_step_customer_label_length"
    CHECK ("customer_label" IS NULL OR char_length("customer_label") BETWEEN 1 AND 120);

ALTER TABLE "job_stage_entry"
  ADD CONSTRAINT "job_stage_entry_text_length"
    CHECK ("text" IS NULL OR char_length("text") BETWEEN 1 AND 500);
