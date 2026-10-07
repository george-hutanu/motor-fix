-- CreateEnum
CREATE TYPE "garage_facility_kind" AS ENUM ('courtesy_car', 'pickup_dropoff', 'waiting_area');

-- CreateEnum
CREATE TYPE "garage_facility_status" AS ENUM ('listed');

-- AlterTable
ALTER TABLE "garage" ADD COLUMN "hours" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "garage_closed_day" (
    "garage_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "note" TEXT,

    CONSTRAINT "garage_closed_day_pkey" PRIMARY KEY ("garage_id","day"),
    CONSTRAINT "garage_closed_day_note" CHECK (char_length("note") <= 80)
);

-- CreateTable
CREATE TABLE "garage_facility" (
    "garage_id" UUID NOT NULL,
    "facility" "garage_facility_kind" NOT NULL,
    "status" "garage_facility_status" NOT NULL DEFAULT 'listed',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "garage_facility_pkey" PRIMARY KEY ("garage_id","facility")
);

-- CreateTable
CREATE TABLE "public_holiday" (
    "day" DATE NOT NULL,
    "name_ro" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,

    CONSTRAINT "public_holiday_pkey" PRIMARY KEY ("day")
);

-- AddForeignKey
ALTER TABLE "garage_closed_day" ADD CONSTRAINT "garage_closed_day_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garage_facility" ADD CONSTRAINT "garage_facility_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Romania's legal holidays for 2026 and 2027 (Labour Code, art. 139). In 2026
-- Children's Day falls on Whit Monday: one row with both names. A later year
-- comes from its own migration; a day already held is skipped.
INSERT INTO "public_holiday" ("day", "name_ro", "name_en") VALUES
    ('2026-01-01', 'Anul Nou', 'New Year'),
    ('2026-01-02', 'Anul Nou', 'New Year'),
    ('2026-01-06', 'Boboteaza', 'Epiphany'),
    ('2026-01-07', 'Sfântul Ioan Botezătorul', 'Saint John the Baptist'),
    ('2026-01-24', 'Ziua Unirii Principatelor Române', 'Union Day'),
    ('2026-04-10', 'Vinerea Mare', 'Orthodox Good Friday'),
    ('2026-04-12', 'Paștele ortodox', 'Orthodox Easter'),
    ('2026-04-13', 'Paștele ortodox', 'Orthodox Easter'),
    ('2026-05-01', 'Ziua Muncii', 'Labour Day'),
    ('2026-05-31', 'Rusalii', 'Whit Sunday'),
    ('2026-06-01', 'Ziua Copilului / A doua zi de Rusalii', 'Children''s Day / Whit Monday'),
    ('2026-08-15', 'Adormirea Maicii Domnului', 'Dormition of the Mother of God'),
    ('2026-11-30', 'Sfântul Andrei', 'Saint Andrew'),
    ('2026-12-01', 'Ziua Națională', 'National Day'),
    ('2026-12-25', 'Crăciunul', 'Christmas'),
    ('2026-12-26', 'Crăciunul', 'Christmas'),
    ('2027-01-01', 'Anul Nou', 'New Year'),
    ('2027-01-02', 'Anul Nou', 'New Year'),
    ('2027-01-06', 'Boboteaza', 'Epiphany'),
    ('2027-01-07', 'Sfântul Ioan Botezătorul', 'Saint John the Baptist'),
    ('2027-01-24', 'Ziua Unirii Principatelor Române', 'Union Day'),
    ('2027-04-30', 'Vinerea Mare', 'Orthodox Good Friday'),
    ('2027-05-01', 'Ziua Muncii', 'Labour Day'),
    ('2027-05-02', 'Paștele ortodox', 'Orthodox Easter'),
    ('2027-05-03', 'Paștele ortodox', 'Orthodox Easter'),
    ('2027-06-01', 'Ziua Copilului', 'Children''s Day'),
    ('2027-06-20', 'Rusalii', 'Whit Sunday'),
    ('2027-06-21', 'A doua zi de Rusalii', 'Whit Monday'),
    ('2027-08-15', 'Adormirea Maicii Domnului', 'Dormition of the Mother of God'),
    ('2027-11-30', 'Sfântul Andrei', 'Saint Andrew'),
    ('2027-12-01', 'Ziua Națională', 'National Day'),
    ('2027-12-25', 'Crăciunul', 'Christmas'),
    ('2027-12-26', 'Crăciunul', 'Christmas')
ON CONFLICT ("day") DO NOTHING;
