-- CreateTable
CREATE TABLE "sms_counter" (
    "account_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "sent_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sms_counter_pkey" PRIMARY KEY ("account_id","month")
);

-- CreateTable
CREATE TABLE "garage_feature" (
    "garage_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,

    CONSTRAINT "garage_feature_pkey" PRIMARY KEY ("garage_id","key")
);

-- AddForeignKey
ALTER TABLE "sms_counter" ADD CONSTRAINT "sms_counter_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garage_feature" ADD CONSTRAINT "garage_feature_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
