-- Time a garage holds on a mechanic, a lift or both, for a walk-in or a phone
-- booking. Its segments, one per Bucharest day it touches, are booking_segment
-- rows, so the exclusion constraints there keep it apart from every booking
-- and every other block. created_by and updated_by carry no foreign key: the
-- row outlives the account that wrote it.
CREATE TABLE "time_block" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "garage_id" UUID NOT NULL,
    "mechanic_id" UUID,
    "lift" INTEGER,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "note" TEXT,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_block_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "time_block_order_check" CHECK ("ends_at" > "starts_at"),
    CONSTRAINT "time_block_note_check" CHECK (char_length("note") <= 200),
    CONSTRAINT "time_block_holder_check" CHECK ("mechanic_id" IS NOT NULL OR "lift" IS NOT NULL)
);

CREATE INDEX "time_block_garage_id_starts_at_idx" ON "time_block"("garage_id", "starts_at");
CREATE INDEX "time_block_mechanic_id_idx" ON "time_block"("mechanic_id");

ALTER TABLE "time_block" ADD CONSTRAINT "time_block_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "time_block" ADD CONSTRAINT "time_block_mechanic_id_fkey" FOREIGN KEY ("mechanic_id") REFERENCES "mechanic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A segment is held by exactly one of a booking and a block. Every row so far
-- has its booking and no block, which the check accepts: no row changes.
ALTER TABLE "booking_segment" ALTER COLUMN "booking_id" DROP NOT NULL;
ALTER TABLE "booking_segment" ADD COLUMN "time_block_id" UUID;
CREATE INDEX "booking_segment_time_block_id_idx" ON "booking_segment"("time_block_id");
ALTER TABLE "booking_segment" ADD CONSTRAINT "booking_segment_time_block_id_fkey" FOREIGN KEY ("time_block_id") REFERENCES "time_block"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_segment" ADD CONSTRAINT "booking_segment_holder_check" CHECK (("booking_id" IS NULL) <> ("time_block_id" IS NULL));
