-- Ticks naming a job the catalogue does not hold are removed first: no reader
-- can resolve them, and the constraint below would refuse them.
DELETE FROM "garage_brand_job" WHERE "job_type_id" NOT IN (SELECT "id" FROM "job_type");

CREATE INDEX "garage_brand_job_job_type_id_idx" ON "garage_brand_job"("job_type_id");

ALTER TABLE "garage_brand_job" ADD CONSTRAINT "garage_brand_job_job_type_id_fkey" FOREIGN KEY ("job_type_id") REFERENCES "job_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
