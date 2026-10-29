-- Who held a car, from which day to which: one open row per car (the owner),
-- closed rows read-only for a former owner up to the sale date.
CREATE TYPE "car_ownership_access" AS ENUM ('owner', 'former_owner_read_only');

CREATE TABLE "car_ownership" (
    "id" UUID NOT NULL,
    "car_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "access" "car_ownership_access" NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE,
    "transfer_id" UUID,
    "opened_at" TIMESTAMPTZ(3) NOT NULL,
    "closed_at" TIMESTAMPTZ(3),

    CONSTRAINT "car_ownership_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "car_ownership_closed_check" CHECK (("to_date" IS NULL) = ("closed_at" IS NULL)),
    CONSTRAINT "car_ownership_access_check" CHECK (("access" = 'owner') = ("to_date" IS NULL)),
    CONSTRAINT "car_ownership_dates_check" CHECK ("to_date" IS NULL OR "to_date" >= "from_date")
);

CREATE UNIQUE INDEX "car_ownership_one_open_idx" ON "car_ownership"("car_id") WHERE "to_date" IS NULL;
CREATE INDEX "car_ownership_account_id_to_date_closed_at_idx" ON "car_ownership"("account_id", "to_date" DESC, "closed_at" DESC);
CREATE INDEX "car_ownership_car_id_account_id_idx" ON "car_ownership"("car_id", "account_id");

ALTER TABLE "car_ownership" ADD CONSTRAINT "car_ownership_car_id_fkey" FOREIGN KEY ("car_id") REFERENCES "car"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "car_ownership" ADD CONSTRAINT "car_ownership_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "car_ownership" ADD CONSTRAINT "car_ownership_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "car_transfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The buyer never inherits the seller's add-car key.
ALTER TABLE "car" ALTER COLUMN "idempotency_key" DROP NOT NULL;

-- Every car so far has had one owner, since it was added; removed cars too.
INSERT INTO "car_ownership" ("id", "car_id", "account_id", "access", "from_date", "opened_at")
SELECT gen_random_uuid(), "id", "owner_id", 'owner', ("created_at" AT TIME ZONE 'Europe/Bucharest')::date, "created_at"
FROM "car";
