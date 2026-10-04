-- CreateEnum
CREATE TYPE "audit_action" AS ENUM ('create', 'update', 'delete', 'open');

-- CreateEnum
CREATE TYPE "audit_actor_role" AS ENUM ('driver', 'owner', 'receptionist', 'mechanic', 'admin', 'system');

-- CreateTable
CREATE TABLE "activity_log" (
    "id" UUID NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "action" "audit_action" NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "field" TEXT,
    "old_value" JSONB,
    "new_value" JSONB,
    "actor_id" UUID,
    "actor_role" "audit_actor_role" NOT NULL,
    "actor_name" TEXT NOT NULL,
    "via_assistant" BOOLEAN NOT NULL DEFAULT false,
    "assistant_grant_id" UUID,
    "garage_id" UUID,
    "car_id" UUID,
    "job_id" UUID,
    "is_key_change" BOOLEAN NOT NULL DEFAULT false,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "kind" TEXT,
    "text" TEXT,

    CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_log_garage_id_at_idx" ON "activity_log"("garage_id", "at");

-- CreateIndex
CREATE INDEX "activity_log_car_id_at_idx" ON "activity_log"("car_id", "at");

-- CreateIndex
CREATE INDEX "activity_log_job_id_at_idx" ON "activity_log"("job_id", "at");

-- CreateIndex
CREATE INDEX "activity_log_actor_id_at_idx" ON "activity_log"("actor_id", "at");

-- The audit history is append-only for every database user, the table owner included.
CREATE FUNCTION "activity_log_refuse"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'activity_log is append-only';
END;
$$;

CREATE TRIGGER "activity_log_append_only"
    BEFORE UPDATE OR DELETE ON "activity_log"
    FOR EACH ROW EXECUTE FUNCTION "activity_log_refuse"();

CREATE TRIGGER "activity_log_no_truncate"
    BEFORE TRUNCATE ON "activity_log"
    FOR EACH STATEMENT EXECUTE FUNCTION "activity_log_refuse"();
