-- CreateEnum
CREATE TYPE "fuel" AS ENUM ('petrol', 'diesel', 'hybrid', 'electric');

-- CreateTable
CREATE TABLE "car" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "fuel" "fuel" NOT NULL,
    "engine" TEXT,
    "odometer_km" INTEGER NOT NULL,
    "plate" TEXT,
    "itp_until" DATE,
    "rca_until" DATE,
    "rovinieta_until" DATE,
    "next_service_km" INTEGER,
    "idempotency_key" TEXT NOT NULL,
    "removed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "car_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "car_model_length" CHECK (char_length("model") BETWEEN 1 AND 40),
    CONSTRAINT "car_year_floor" CHECK ("year" >= 1950),
    CONSTRAINT "car_engine_length" CHECK ("engine" IS NULL OR char_length("engine") <= 30),
    CONSTRAINT "car_odometer_range" CHECK ("odometer_km" BETWEEN 0 AND 2000000),
    CONSTRAINT "car_plate_shape" CHECK ("plate" IS NULL OR "plate" ~ '^[A-Z0-9]{2,12}$'),
    CONSTRAINT "car_idempotency_key_length" CHECK (char_length("idempotency_key") BETWEEN 1 AND 64)
);

-- CreateIndex
CREATE INDEX "car_owner_id_created_at_idx" ON "car"("owner_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "car_owner_id_idempotency_key_key" ON "car"("owner_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "car" ADD CONSTRAINT "car_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "car" ADD CONSTRAINT "car_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- No car existed before this table, so a reminder naming one points nowhere.
DELETE FROM "reminder" WHERE "car_id" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "reminder" ADD CONSTRAINT "reminder_car_id_fkey" FOREIGN KEY ("car_id") REFERENCES "car"("id") ON DELETE CASCADE ON UPDATE CASCADE;
