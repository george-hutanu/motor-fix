-- A garage a driver keeps on their account; the time is the first save.
CREATE TABLE "saved_garage" (
    "account_id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "saved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_garage_pkey" PRIMARY KEY ("account_id","garage_id")
);

ALTER TABLE "saved_garage" ADD CONSTRAINT "saved_garage_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "saved_garage" ADD CONSTRAINT "saved_garage_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
