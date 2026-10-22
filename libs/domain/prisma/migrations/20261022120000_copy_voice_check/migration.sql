-- A stored copy voice is empty or 1-5, whoever writes the row.
ALTER TABLE "quote_request" ADD CONSTRAINT "quote_request_copy_voice_check" CHECK ("copy_voice" BETWEEN 1 AND 5);
ALTER TABLE "listing_draft" ADD CONSTRAINT "listing_draft_copy_voice_check" CHECK ("copy_voice" BETWEEN 1 AND 5);
