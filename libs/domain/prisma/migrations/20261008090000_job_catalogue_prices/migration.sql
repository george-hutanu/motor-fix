-- CreateEnum
CREATE TYPE "job_type_status" AS ENUM ('approved', 'pending', 'rejected');

-- AlterTable
ALTER TABLE "garage" ADD COLUMN     "labour_from_bani" INTEGER,
ADD COLUMN     "labour_to_bani" INTEGER;

-- CreateTable
CREATE TABLE "job_type" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name_ro" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "status" "job_type_status" NOT NULL DEFAULT 'pending',
    "car_system" TEXT,
    "rar_activity" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garage_price" (
    "id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "job_type_id" UUID NOT NULL,
    "brand_id" UUID,
    "from_bani" INTEGER NOT NULL,
    "to_bani" INTEGER,
    "duration_minutes" INTEGER,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID NOT NULL,

    CONSTRAINT "garage_price_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_type_key_key" ON "job_type"("key");

-- CreateIndex
CREATE INDEX "garage_price_job_type_id_idx" ON "garage_price"("job_type_id");

-- CreateIndex
CREATE INDEX "garage_price_brand_id_idx" ON "garage_price"("brand_id");

-- AddForeignKey
ALTER TABLE "garage_price" ADD CONSTRAINT "garage_price_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garage_price" ADD CONSTRAINT "garage_price_job_type_id_fkey" FOREIGN KEY ("job_type_id") REFERENCES "job_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garage_price" ADD CONSTRAINT "garage_price_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One range per garage, job and brand, the default range (no brand) included:
-- Prisma cannot express NULLS NOT DISTINCT, so the schema has no @@unique for it.
CREATE UNIQUE INDEX "garage_price_one_range" ON "garage_price"("garage_id", "job_type_id", "brand_id") NULLS NOT DISTINCT;
