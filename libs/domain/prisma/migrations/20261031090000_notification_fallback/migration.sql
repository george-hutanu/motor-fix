-- The last message of one type a person got on another channel, and why.
CREATE TYPE "notification_fallback_reason" AS ENUM ('no_device', 'phone_not_verified', 'sms_cap_reached', 'send_failed');

CREATE TABLE "notification_fallback" (
    "account_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "from" "notification_channel" NOT NULL,
    "to" "notification_channel" NOT NULL,
    "reason" "notification_fallback_reason" NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_fallback_pkey" PRIMARY KEY ("account_id", "type")
);

ALTER TABLE "notification_fallback" ADD CONSTRAINT "notification_fallback_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
