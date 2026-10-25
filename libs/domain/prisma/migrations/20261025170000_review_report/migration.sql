-- CreateEnum
CREATE TYPE "review_report_target" AS ENUM ('review', 'reply');

-- CreateEnum
CREATE TYPE "review_report_reason" AS ENUM ('insults', 'personal_data', 'ads', 'promotion', 'off_topic', 'hate', 'fake_or_conflicted', 'threats_or_legal_accusations', 'other');

-- CreateEnum
CREATE TYPE "review_report_source" AS ENUM ('garage', 'author', 'automatic');

-- CreateEnum
CREATE TYPE "review_report_status" AS ENUM ('pending', 'decided', 'closed');

-- CreateEnum
CREATE TYPE "review_report_decision" AS ENUM ('kept', 'removed');

-- CreateTable
CREATE TABLE "review_report" (
    "id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "target" "review_report_target" NOT NULL DEFAULT 'review',
    "reason" "review_report_reason" NOT NULL,
    "text" TEXT,
    "source" "review_report_source" NOT NULL,
    "reporter_id" UUID,
    "status" "review_report_status" NOT NULL DEFAULT 'pending',
    "decision" "review_report_decision",
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "review_report_review_id_idx" ON "review_report"("review_id");

-- One pending report per review; Prisma's schema cannot express a partial index.
CREATE UNIQUE INDEX "review_report_one_pending" ON "review_report"("review_id") WHERE "status" = 'pending';

-- AddForeignKey
ALTER TABLE "review_report" ADD CONSTRAINT "review_report_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_report" ADD CONSTRAINT "review_report_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_report" ADD CONSTRAINT "review_report_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
