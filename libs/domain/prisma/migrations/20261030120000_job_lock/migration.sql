-- The job's version for a change based on a stale read, and the mirror of
-- its Redis edit lock with the last forced unlock.
ALTER TABLE "job"
    ADD COLUMN "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "lock_holder_id" UUID,
    ADD COLUMN "lock_holder_role" TEXT,
    ADD COLUMN "lock_since" TIMESTAMPTZ(3),
    ADD COLUMN "lock_last_change_at" TIMESTAMPTZ(3),
    ADD COLUMN "lock_forced_by_id" UUID,
    ADD COLUMN "lock_forced_at" TIMESTAMPTZ(3),
    ADD COLUMN "lock_forced_holder_id" UUID;

-- An existing job was never changed under a version: its version is its creation.
UPDATE "job" SET "updated_at" = "created_at";

ALTER TABLE "job" ADD CONSTRAINT "job_lock_holder_id_fkey" FOREIGN KEY ("lock_holder_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "job" ADD CONSTRAINT "job_lock_forced_by_id_fkey" FOREIGN KEY ("lock_forced_by_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "job" ADD CONSTRAINT "job_lock_forced_holder_id_fkey" FOREIGN KEY ("lock_forced_holder_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
