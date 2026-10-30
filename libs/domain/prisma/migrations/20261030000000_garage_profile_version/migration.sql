ALTER TABLE "garage"
  ADD COLUMN "profile_version" INTEGER NOT NULL DEFAULT 0,
  DROP CONSTRAINT "garage_known_for_length",
  ADD CONSTRAINT "garage_known_for_length" CHECK (char_length("known_for") BETWEEN 1 AND 1000);
