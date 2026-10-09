-- The rows written so far are the whole country's.
ALTER TABLE "platform_daily" ADD COLUMN "city" VARCHAR(80) NOT NULL DEFAULT 'all';
ALTER TABLE "platform_daily" ALTER COLUMN "active_drivers" DROP NOT NULL;

ALTER TABLE "platform_daily" DROP CONSTRAINT "platform_daily_pkey";
ALTER TABLE "platform_daily" ADD CONSTRAINT "platform_daily_pkey" PRIMARY KEY ("day", "city");
