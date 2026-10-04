-- CreateTable
CREATE TABLE "notification_preference" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "garage_id" UUID,
    "type" TEXT NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_preference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_preference_account_id_type_idx" ON "notification_preference"("account_id", "type");

-- CreateIndex
CREATE INDEX "notification_preference_garage_id_idx" ON "notification_preference"("garage_id");

-- AddForeignKey
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

