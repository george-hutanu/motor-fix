-- CreateEnum
CREATE TYPE "odometer_source" AS ENUM ('driver', 'reception', 'repair');

-- CreateTable
CREATE TABLE "odometer_reading" (
    "id" UUID NOT NULL,
    "car_id" UUID NOT NULL,
    "km" INTEGER NOT NULL,
    "read_on" DATE NOT NULL,
    "source" "odometer_source" NOT NULL,
    "source_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "odometer_reading_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "odometer_reading_km_check" CHECK ("km" >= 0)
);

-- CreateIndex
CREATE INDEX "odometer_reading_car_id_read_on_created_at_idx" ON "odometer_reading"("car_id", "read_on" DESC, "created_at" DESC);

-- AddForeignKey
ALTER TABLE "odometer_reading" ADD CONSTRAINT "odometer_reading_car_id_fkey" FOREIGN KEY ("car_id") REFERENCES "car"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "reminder" ADD COLUMN "due_km" INTEGER;

-- Every existing car gets one reading: its odometer on the day it last changed.
INSERT INTO "odometer_reading" ("id", "car_id", "km", "read_on", "source", "created_at")
SELECT gen_random_uuid(), "id", "odometer_km", ("updated_at" AT TIME ZONE 'Europe/Bucharest')::date, 'driver', "updated_at"
FROM "car";
