-- A garage's send carries its Idempotency-Key: a repeat from the same garage
-- answers the first quote instead of writing a second one.
ALTER TABLE "quote" ADD COLUMN "idempotency_key" TEXT NOT NULL DEFAULT gen_random_uuid()::text;
ALTER TABLE "quote" ALTER COLUMN "idempotency_key" DROP DEFAULT;
ALTER TABLE "quote" ADD CONSTRAINT "quote_idempotency_key_length" CHECK (char_length("idempotency_key") BETWEEN 1 AND 200);
CREATE UNIQUE INDEX "quote_garage_id_idempotency_key_key" ON "quote"("garage_id", "idempotency_key");
