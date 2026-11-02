-- AlterTable
ALTER TABLE "job" ADD COLUMN "in_work_since" TIMESTAMPTZ(3);

-- A job already in work keeps running from its latest move into work.
UPDATE "job" SET "in_work_since" = COALESCE(
  (SELECT max(e."at") FROM "job_stage_entry" e WHERE e."job_id" = "job"."id" AND e."to_status" = 'in_work'),
  "started_at",
  now()
)
WHERE "status" = 'in_work';
