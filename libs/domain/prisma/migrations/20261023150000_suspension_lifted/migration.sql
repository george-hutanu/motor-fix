-- A lifted suspension names the admin who put the garage back on the map and
-- the note they wrote; rows already there keep both empty.
ALTER TABLE "garage_suspension" ADD COLUMN "lift_note" TEXT,
ADD COLUMN "lifted_by" UUID;
