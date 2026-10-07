-- CreateTable
CREATE TABLE "platform_daily" (
    "day" DATE NOT NULL,
    "garages_listed" INTEGER NOT NULL,
    "garages_approved_this_month" INTEGER NOT NULL,
    "active_drivers" INTEGER NOT NULL,
    "written_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_daily_pkey" PRIMARY KEY ("day")
);
