-- The mechanic card's own fields (ST-56), and the garage owner's own row.
ALTER TABLE "mechanic"
  ADD COLUMN "role_title" TEXT,
  ADD COLUMN "specialties" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "certifications" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "years" INTEGER,
  ADD COLUMN "brand_ids" UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN "is_owner" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "working_hours" JSONB;

-- The joined line of six specialties of 40 characters is 250 long.
ALTER TABLE "mechanic" DROP CONSTRAINT "mechanic_speciality_length";
ALTER TABLE "mechanic" ADD CONSTRAINT "mechanic_speciality_length" CHECK (char_length("speciality") <= 250);
ALTER TABLE "mechanic" ADD CONSTRAINT "mechanic_role_title_length" CHECK (char_length("role_title") <= 40);
ALTER TABLE "mechanic" ADD CONSTRAINT "mechanic_years_range" CHECK ("years" BETWEEN 0 AND 60);
ALTER TABLE "mechanic" ADD CONSTRAINT "mechanic_specialties_count" CHECK (cardinality("specialties") <= 6);
ALTER TABLE "mechanic" ADD CONSTRAINT "mechanic_certifications_count" CHECK (cardinality("certifications") <= 10);

-- The owner's card where the owner already has one at their garage.
UPDATE "mechanic" m SET "is_owner" = true
FROM "garage_member" gm
WHERE gm."garage_id" = m."garage_id" AND gm."account_id" = m."account_id" AND gm."role" = 'owner';

-- Every other garage gets the owner's row, unless the owner's account already
-- holds a card at another garage (account_id is unique). The name keeps the
-- card's own bounds (2..80): a longer account name is cut, a shorter one skipped.
INSERT INTO "mechanic" ("id", "garage_id", "account_id", "name", "on_profile", "can_move_bookings", "can_answer_quotes", "can_record_final_price", "is_owner", "working_hours")
SELECT gen_random_uuid(), g."id", gm."account_id", left(btrim(a."name"), 80), false, true, true, true, true, g."hours"
FROM "garage" g
JOIN "garage_member" gm ON gm."garage_id" = g."id" AND gm."role" = 'owner'
JOIN "account" a ON a."id" = gm."account_id"
WHERE char_length(btrim(a."name")) >= 2
  AND NOT EXISTS (SELECT 1 FROM "mechanic" m WHERE m."garage_id" = g."id" AND m."is_owner")
  AND NOT EXISTS (SELECT 1 FROM "mechanic" m WHERE m."account_id" = gm."account_id");
