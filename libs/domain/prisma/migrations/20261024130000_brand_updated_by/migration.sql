-- The admin who last changed a brand: the loader skips it from then on.
ALTER TABLE "brand" ADD COLUMN "updated_by" UUID;
