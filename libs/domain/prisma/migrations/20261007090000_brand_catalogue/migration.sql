-- CreateEnum
CREATE TYPE "garage_brand_stance" AS ENUM ('works_on', 'does_not_take');

-- AlterTable
ALTER TABLE "garage" ADD COLUMN     "brand_note" TEXT,
ADD COLUMN     "refusal_phrase" TEXT;

-- CreateTable
CREATE TABLE "brand" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "popularity" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garage_brand" (
    "garage_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "stance" "garage_brand_stance" NOT NULL,
    "petrol" BOOLEAN NOT NULL DEFAULT true,
    "diesel" BOOLEAN NOT NULL DEFAULT true,
    "hybrid" BOOLEAN NOT NULL DEFAULT true,
    "electric" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "garage_brand_pkey" PRIMARY KEY ("garage_id","brand_id")
);

-- CreateTable
CREATE TABLE "garage_brand_job" (
    "garage_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "job_type_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "garage_brand_job_pkey" PRIMARY KEY ("garage_id","brand_id","job_type_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brand_key_key" ON "brand"("key");

-- CreateIndex
CREATE UNIQUE INDEX "brand_name_key" ON "brand"("name");

-- CreateIndex
CREATE UNIQUE INDEX "brand_slug_key" ON "brand"("slug");

-- CreateIndex
CREATE INDEX "brand_active_popularity_name_idx" ON "brand"("active", "popularity", "name");

-- CreateIndex
CREATE INDEX "garage_brand_brand_id_idx" ON "garage_brand"("brand_id");

-- AddForeignKey
ALTER TABLE "garage_brand" ADD CONSTRAINT "garage_brand_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garage_brand" ADD CONSTRAINT "garage_brand_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garage_brand_job" ADD CONSTRAINT "garage_brand_job_garage_id_brand_id_fkey" FOREIGN KEY ("garage_id", "brand_id") REFERENCES "garage_brand"("garage_id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A does_not_take row carries no fuel tick.
ALTER TABLE "garage_brand" ADD CONSTRAINT "garage_brand_fuel_check" CHECK ("stance" = 'works_on' OR NOT ("petrol" OR "diesel" OR "hybrid" OR "electric"));

-- Nothing blank is stored: the writer trims an empty text to NULL.
ALTER TABLE "garage" ADD CONSTRAINT "garage_brand_note_check" CHECK ("brand_note" IS NULL OR (char_length("brand_note") <= 140 AND btrim("brand_note") <> ''));

ALTER TABLE "garage" ADD CONSTRAINT "garage_refusal_phrase_check" CHECK ("refusal_phrase" IS NULL OR (char_length("refusal_phrase") <= 60 AND btrim("refusal_phrase") <> ''));
