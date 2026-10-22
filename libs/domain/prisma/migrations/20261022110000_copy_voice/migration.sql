-- The copy voice of the visit (1-5), stored only with analytics consent.
ALTER TABLE "quote_request" ADD COLUMN "copy_voice" SMALLINT;
ALTER TABLE "listing_draft" ADD COLUMN "copy_voice" SMALLINT;
