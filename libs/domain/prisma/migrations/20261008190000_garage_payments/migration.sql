-- AlterTable: the payment methods and the courtesy car's price of step 5.
ALTER TABLE "garage"
  ADD COLUMN "payment_cash" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "payment_card" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "payment_transfer" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "courtesy_car_paid" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "courtesy_car_price_per_day_bani" INTEGER,
  ADD CONSTRAINT "garage_courtesy_price_with_paid"
    CHECK ("courtesy_car_paid" = ("courtesy_car_price_per_day_bani" IS NOT NULL)),
  ADD CONSTRAINT "garage_courtesy_price_range"
    CHECK ("courtesy_car_price_per_day_bani" IS NULL OR ("courtesy_car_price_per_day_bani" BETWEEN 100 AND 200000 AND "courtesy_car_price_per_day_bani" % 100 = 0));
