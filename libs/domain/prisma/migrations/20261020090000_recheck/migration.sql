-- An admin's monthly look-up of an approved garage in a register.
CREATE TYPE "recheck_kind" AS ENUM ('rar');
CREATE TYPE "recheck_result" AS ENUM ('ok', 'failed');
CREATE TYPE "recheck_failure" AS ENUM ('expired', 'suspended', 'withdrawn');

CREATE TABLE "recheck" (
    "id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "kind" "recheck_kind" NOT NULL DEFAULT 'rar',
    "checked_on" DATE NOT NULL,
    "result" "recheck_result" NOT NULL,
    "failure" "recheck_failure",
    "detail" TEXT,
    "rar_activities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "automatic" BOOLEAN NOT NULL DEFAULT false,
    "recorded_by" UUID,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recheck_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "recheck_failure_check" CHECK (("result" = 'failed') = ("failure" IS NOT NULL)),
    CONSTRAINT "recheck_detail_check" CHECK (
        ("result" = 'failed') = ("detail" IS NOT NULL)
        AND char_length("detail") BETWEEN 1 AND 200
    )
);

CREATE INDEX "recheck_garage_id_recorded_at_idx" ON "recheck"("garage_id", "recorded_at");

ALTER TABLE "recheck" ADD CONSTRAINT "recheck_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
