-- When the driver first saw the quote in the comparison; written once, no backfill.
ALTER TABLE "quote" ADD COLUMN "first_seen_at" TIMESTAMPTZ(3);
