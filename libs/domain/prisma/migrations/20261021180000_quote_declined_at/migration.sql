-- When the driver declined a waiting quote.
ALTER TABLE "quote" ADD COLUMN "declined_at" TIMESTAMPTZ(3);
