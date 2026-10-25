-- When a review was last edited; empty until an edit writes it.
ALTER TABLE "review" ADD COLUMN "edited_at" TIMESTAMPTZ(3);
