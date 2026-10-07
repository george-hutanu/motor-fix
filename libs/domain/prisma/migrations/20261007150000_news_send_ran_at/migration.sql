-- AlterTable
-- No backfill: a month that ran before this column existed and whose event is
-- still kept (7 days) is queued once more at deploy, which sends nothing, as
-- every driver already has the month's message, and then marks it ran.
ALTER TABLE "news_send" ADD COLUMN "ran_at" TIMESTAMPTZ(3);
