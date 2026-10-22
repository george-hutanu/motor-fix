-- AlterTable
ALTER TABLE "garage_photo" ADD COLUMN "variant_path" TEXT,
ADD COLUMN "thumbhash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "garage_photo_variant_path_key" ON "garage_photo"("variant_path");

ALTER TABLE "garage_photo" ADD CONSTRAINT "garage_photo_thumbhash_check" CHECK ("thumbhash" IS NULL OR char_length("thumbhash") <= 64);
