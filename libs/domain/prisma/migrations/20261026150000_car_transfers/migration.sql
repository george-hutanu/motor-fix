-- A car's repair history, read by the sale: done through MotorFix (its job
-- set) or logged by the owner. No writer yet.
CREATE TYPE "repair_source" AS ENUM ('motorfix', 'logged');

CREATE TABLE "repair" (
    "id" UUID NOT NULL,
    "car_id" UUID NOT NULL,
    "job_id" UUID,
    "source" "repair_source" NOT NULL,
    "what" TEXT NOT NULL,
    "garage_name" TEXT NOT NULL,
    "garage_id" UUID,
    "done_on" DATE NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repair_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "repair_source_job_check" CHECK (("source" = 'motorfix') = ("job_id" IS NOT NULL))
);

CREATE UNIQUE INDEX "repair_job_id_key" ON "repair"("job_id");
CREATE INDEX "repair_car_id_done_on_created_at_idx" ON "repair"("car_id", "done_on" DESC, "created_at" DESC);

ALTER TABLE "repair" ADD CONSTRAINT "repair_car_id_fkey" FOREIGN KEY ("car_id") REFERENCES "car"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "repair" ADD CONSTRAINT "repair_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "repair" ADD CONSTRAINT "repair_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A car handed to a buyer by a link: the token's hash only, the phone in
-- E.164, at most one sent transfer per car.
CREATE TYPE "car_transfer_status" AS ENUM ('sent', 'accepted', 'cancelled', 'expired');

CREATE TABLE "car_transfer" (
    "id" UUID NOT NULL,
    "car_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "buyer_phone" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" "car_transfer_status" NOT NULL DEFAULT 'sent',
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "buyer_id" UUID,
    "sale_date" DATE,

    CONSTRAINT "car_transfer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "car_transfer_expiry_check" CHECK ("expires_at" > "sent_at"),
    CONSTRAINT "car_transfer_buyer_phone_check" CHECK ("buyer_phone" ~ '^\+[1-9][0-9]{6,14}$')
);

CREATE UNIQUE INDEX "car_transfer_token_hash_key" ON "car_transfer"("token_hash");
CREATE UNIQUE INDEX "car_transfer_one_sent_idx" ON "car_transfer"("car_id") WHERE "status" = 'sent';
CREATE INDEX "car_transfer_status_expires_at_idx" ON "car_transfer"("status", "expires_at");
CREATE INDEX "car_transfer_seller_id_idx" ON "car_transfer"("seller_id");

ALTER TABLE "car_transfer" ADD CONSTRAINT "car_transfer_car_id_fkey" FOREIGN KEY ("car_id") REFERENCES "car"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "car_transfer" ADD CONSTRAINT "car_transfer_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "car_transfer" ADD CONSTRAINT "car_transfer_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The repairs a seller ticked to pass on with the car.
CREATE TABLE "car_transfer_repair" (
    "transfer_id" UUID NOT NULL,
    "repair_id" UUID NOT NULL,

    CONSTRAINT "car_transfer_repair_pkey" PRIMARY KEY ("transfer_id", "repair_id")
);

ALTER TABLE "car_transfer_repair" ADD CONSTRAINT "car_transfer_repair_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "car_transfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "car_transfer_repair" ADD CONSTRAINT "car_transfer_repair_repair_id_fkey" FOREIGN KEY ("repair_id") REFERENCES "repair"("id") ON DELETE CASCADE ON UPDATE CASCADE;
