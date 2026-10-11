-- The version an edit sends back; an existing car starts at its creation.
ALTER TABLE "car" ADD COLUMN "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "car" SET "updated_at" = "created_at";
