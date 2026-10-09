-- AlterTable
ALTER TABLE "garage" ADD COLUMN "city_key" VARCHAR(80),
ADD COLUMN "city_name" VARCHAR(80);

ALTER TABLE "garage" ADD CONSTRAINT "garage_city_key_slug"
  CHECK ("city_key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "garage" ADD CONSTRAINT "garage_city_both"
  CHECK (("city_key" IS NULL) = ("city_name" IS NULL));

-- CreateIndex
CREATE INDEX "garage_city_key_idx" ON "garage"("city_key");
