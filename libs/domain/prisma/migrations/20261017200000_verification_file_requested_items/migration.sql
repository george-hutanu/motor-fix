ALTER TABLE "verification_file" ADD COLUMN "requested_items" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
