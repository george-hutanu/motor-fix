-- A mechanic's Saturday switch: on wherever the stored hours already hold a
-- Saturday interval, so no mechanic stops working Saturdays.
ALTER TABLE "mechanic" ADD COLUMN "works_saturdays" BOOLEAN NOT NULL DEFAULT false;
UPDATE "mechanic" SET "works_saturdays" = true
WHERE jsonb_typeof("working_hours" -> 'sat') = 'array'
  AND jsonb_array_length("working_hours" -> 'sat') > 0;

-- A mechanic's days off, one row per day or range entered.
CREATE TABLE "mechanic_day_off" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mechanic_id" UUID NOT NULL,
    "first_day" DATE NOT NULL,
    "last_day" DATE NOT NULL,
    "note" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mechanic_day_off_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mechanic_day_off_order_check" CHECK ("last_day" >= "first_day"),
    CONSTRAINT "mechanic_day_off_note_check" CHECK ("note" IS NULL OR char_length("note") <= 120)
);

CREATE INDEX "mechanic_day_off_mechanic_id_last_day_idx" ON "mechanic_day_off"("mechanic_id", "last_day");

ALTER TABLE "mechanic_day_off" ADD CONSTRAINT "mechanic_day_off_mechanic_id_fkey" FOREIGN KEY ("mechanic_id") REFERENCES "mechanic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
