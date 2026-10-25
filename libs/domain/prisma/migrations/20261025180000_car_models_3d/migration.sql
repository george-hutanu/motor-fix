-- CreateEnum
CREATE TYPE "body_style" AS ENUM ('saloon', 'hatchback', 'suv', 'crossover', 'estate', 'fastback');

-- AlterTable
ALTER TABLE "brand" ADD COLUMN     "body_style" "body_style" NOT NULL DEFAULT 'saloon';

-- CreateTable
CREATE TABLE "car_system" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "fuel_types" "fuel"[],
    "name_ro" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "car_system_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "car_model_3d" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "brand_id" UUID NOT NULL,
    "model" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "popularity" INTEGER NOT NULL,
    "fuel" "fuel" NOT NULL,
    "body_style" "body_style" NOT NULL,
    "licence_ref" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "car_model_3d_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "car_system_code_key" ON "car_system"("code");

-- CreateIndex
CREATE UNIQUE INDEX "car_system_position_key" ON "car_system"("position");

-- CreateIndex
CREATE UNIQUE INDEX "car_model_3d_key_key" ON "car_model_3d"("key");

-- CreateIndex
CREATE UNIQUE INDEX "car_model_3d_file_key_key" ON "car_model_3d"("file_key");

-- CreateIndex
CREATE INDEX "car_model_3d_brand_id_popularity_idx" ON "car_model_3d"("brand_id", "popularity");

-- AddForeignKey
ALTER TABLE "car_model_3d" ADD CONSTRAINT "car_model_3d_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
