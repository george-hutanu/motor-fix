-- A mechanic card whose account was deleted keeps its reviews and bookings and
-- leaves the team list; no older card can be told apart, so none is backfilled.
ALTER TABLE "mechanic" ADD COLUMN "removed_at" TIMESTAMPTZ(3);
