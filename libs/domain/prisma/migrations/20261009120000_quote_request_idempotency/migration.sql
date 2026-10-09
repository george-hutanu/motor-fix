-- A seeded environment already holds requests: each gets a key of its own,
-- then new rows must bring theirs.
ALTER TABLE "quote_request"
  ADD COLUMN "idempotency_key" TEXT NOT NULL DEFAULT gen_random_uuid()::text;
ALTER TABLE "quote_request" ALTER COLUMN "idempotency_key" DROP DEFAULT;

ALTER TABLE "quote_request" ADD CONSTRAINT "quote_request_idempotency_key_length"
  CHECK (char_length("idempotency_key") BETWEEN 1 AND 64);

CREATE UNIQUE INDEX "quote_request_driver_id_idempotency_key_key"
  ON "quote_request"("driver_id", "idempotency_key");
