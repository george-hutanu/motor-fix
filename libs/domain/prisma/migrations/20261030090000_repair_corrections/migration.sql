-- A repair's reading, amount, sharing with the garage it names, and the
-- version and last writer a correction checks and sets.
CREATE TYPE "repair_updater" AS ENUM ('driver', 'owner', 'admin');

ALTER TABLE "repair"
    ADD COLUMN "odometer_km" INTEGER,
    ADD COLUMN "cost_bani" INTEGER,
    ADD COLUMN "shared_with_garage" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "shared_at" TIMESTAMPTZ(3),
    ADD COLUMN "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "updated_by" UUID,
    ADD COLUMN "updated_by_role" "repair_updater",
    ADD CONSTRAINT "repair_odometer_km_check" CHECK ("odometer_km" BETWEEN 0 AND 2000000),
    ADD CONSTRAINT "repair_cost_bani_check" CHECK ("cost_bani" BETWEEN 0 AND 92000000),
    ADD CONSTRAINT "repair_updated_by_role_check" CHECK ("updated_by_role" IS NOT NULL OR "updated_by" IS NULL);

-- An existing repair was never edited: its version is its creation.
UPDATE "repair" SET "updated_at" = "created_at";

ALTER TABLE "repair" ADD CONSTRAINT "repair_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The garage owner's list: the shared logged repairs naming the garage.
CREATE INDEX "repair_shared_garage_idx" ON "repair"("garage_id", "done_on" DESC, "created_at" DESC)
    WHERE "source" = 'logged' AND "shared_with_garage" AND "deleted_at" IS NULL;
