-- A driver's accept carries its Idempotency-Key: a repeat from the same
-- driver answers the first booking instead of writing a second one. Bookings
-- other paths write have none, and NULLs never collide.
ALTER TABLE "booking" ADD COLUMN "idempotency_key" TEXT;
ALTER TABLE "booking" ADD CONSTRAINT "booking_idempotency_key_length" CHECK ("idempotency_key" IS NULL OR char_length("idempotency_key") BETWEEN 1 AND 200);
CREATE UNIQUE INDEX "booking_driver_id_idempotency_key_key" ON "booking"("driver_id", "idempotency_key");
