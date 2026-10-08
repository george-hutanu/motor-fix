-- The garage's details, the mechanic cards an owner names while listing, and
-- the jobs a garage proposes to the catalogue.

CREATE TYPE "business_kind" AS ENUM ('company', 'pfa', 'ii', 'mobile');
CREATE TYPE "mobile_legal_form" AS ENUM ('pfa', 'company');

-- Existing garages predate the listing form, so every column stays empty.
ALTER TABLE "garage"
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "known_for" TEXT,
  ADD COLUMN "business_kind" "business_kind",
  ADD COLUMN "mobile_legal_form" "mobile_legal_form",
  ADD CONSTRAINT "garage_phone_romanian" CHECK ("phone" ~ '^\+40[0-9]{9}$'),
  ADD CONSTRAINT "garage_known_for_length" CHECK (char_length("known_for") BETWEEN 1 AND 160),
  ADD CONSTRAINT "garage_legal_form_mobile" CHECK ("mobile_legal_form" IS NULL OR "business_kind" = 'mobile');

-- A card has no account until its invite is accepted. The unique index on
-- account_id stays: PostgreSQL holds NULLs distinct.
ALTER TABLE "mechanic"
  ALTER COLUMN "account_id" DROP NOT NULL,
  ADD COLUMN "name" TEXT,
  ADD COLUMN "speciality" TEXT,
  ADD COLUMN "on_profile" BOOLEAN NOT NULL DEFAULT false;

UPDATE "mechanic" m SET "name" = a."name" FROM "account" a WHERE a."id" = m."account_id";

ALTER TABLE "mechanic"
  ALTER COLUMN "name" SET NOT NULL,
  -- 80, as an invite's name; a card the owner names is held to 60 by its
  -- write. NOT VALID: an account name copied above predates the rule.
  ADD CONSTRAINT "mechanic_name_length" CHECK (char_length("name") BETWEEN 2 AND 80) NOT VALID,
  ADD CONSTRAINT "mechanic_speciality_length" CHECK (char_length("speciality") <= 80);

ALTER TABLE "job_type"
  ADD COLUMN "proposed_by_garage_id" UUID,
  ADD CONSTRAINT "job_type_proposed_by_garage_id_fkey" FOREIGN KEY ("proposed_by_garage_id") REFERENCES "garage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "job_type_proposed_by_garage_id_idx" ON "job_type"("proposed_by_garage_id");
