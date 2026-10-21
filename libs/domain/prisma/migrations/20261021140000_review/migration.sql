-- CreateEnum
CREATE TYPE "review_source" AS ENUM ('job', 'profile');

-- CreateEnum
CREATE TYPE "review_status" AS ENUM ('published', 'reported', 'removed', 'deleted_by_author');

-- CreateTable
CREATE TABLE "review" (
    "id" UUID NOT NULL,
    "source" "review_source" NOT NULL DEFAULT 'job',
    "job_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "mechanic_id" UUID,
    "rating" INTEGER NOT NULL,
    "text" TEXT,
    "paid_bani" INTEGER,
    "status" "review_status" NOT NULL DEFAULT 'published',
    "posted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "review_rating_range" CHECK ("rating" BETWEEN 1 AND 5),
    CONSTRAINT "review_paid_bani_range" CHECK ("paid_bani" IS NULL OR "paid_bani" BETWEEN 1 AND 100000000)
);

-- One live review per job; Prisma's schema cannot express a partial index.
CREATE UNIQUE INDEX "review_one_live" ON "review"("job_id") WHERE "status" IN ('published', 'reported', 'removed');

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_mechanic_id_fkey" FOREIGN KEY ("mechanic_id") REFERENCES "mechanic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
