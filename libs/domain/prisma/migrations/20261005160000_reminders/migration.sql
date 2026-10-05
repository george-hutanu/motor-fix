-- CreateEnum
CREATE TYPE "reminder_kind" AS ENUM ('itp', 'service', 'rca', 'rovinieta', 'tyres_winter', 'tyres_summer', 'booking');

-- CreateTable
CREATE TABLE "reminder" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "car_id" UUID,
    "booking_id" UUID,
    "kind" "reminder_kind" NOT NULL,
    "due_on" DATE,
    "sent_30" BOOLEAN NOT NULL DEFAULT false,
    "sent_7" BOOLEAN NOT NULL DEFAULT false,
    "season_year" INTEGER,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reminder_booking_id_key" ON "reminder"("booking_id");

-- CreateIndex
CREATE INDEX "reminder_account_id_idx" ON "reminder"("account_id");

-- CreateIndex
CREATE INDEX "reminder_due_on_idx" ON "reminder"("due_on");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_car_id_kind_key" ON "reminder"("car_id", "kind");

-- AddForeignKey
ALTER TABLE "reminder" ADD CONSTRAINT "reminder_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A reminder is about a car, or (kind booking) about a booking: never both.
ALTER TABLE "reminder" ADD CONSTRAINT "reminder_subject_check" CHECK (
    ("kind" = 'booking') = ("booking_id" IS NOT NULL)
    AND ("car_id" IS NULL) = ("booking_id" IS NOT NULL)
);

