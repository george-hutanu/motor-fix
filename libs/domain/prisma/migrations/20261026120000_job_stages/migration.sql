-- A job's reception (the first time and the odometer reading) and its time in work.
ALTER TABLE "job" ADD COLUMN "received_at" TIMESTAMPTZ(3),
ADD COLUMN "odometer_km" INTEGER,
ADD COLUMN "worked_seconds" INTEGER NOT NULL DEFAULT 0,
ADD CONSTRAINT "job_odometer_km_check" CHECK ("odometer_km" IS NULL OR "odometer_km" BETWEEN 0 AND 2000000),
ADD CONSTRAINT "job_worked_seconds_check" CHECK ("worked_seconds" >= 0);

-- Each stage entry keeps the job's mechanic at that moment, and whether the
-- platform made the move on its own.
ALTER TABLE "job_stage_entry" ADD COLUMN "mechanic_id" UUID,
ADD COLUMN "auto" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "job_stage_entry" ADD CONSTRAINT "job_stage_entry_mechanic_id_fkey" FOREIGN KEY ("mechanic_id") REFERENCES "mechanic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "job_stage_entry_mechanic_id_idx" ON "job_stage_entry"("mechanic_id");
