-- A driver's no to saving a garage after a finished job there; the time is
-- the first no.
CREATE TABLE "save_suggestion_dismissal" (
    "account_id" UUID NOT NULL,
    "garage_id" UUID NOT NULL,
    "dismissed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "save_suggestion_dismissal_pkey" PRIMARY KEY ("account_id","garage_id")
);

ALTER TABLE "save_suggestion_dismissal" ADD CONSTRAINT "save_suggestion_dismissal_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "save_suggestion_dismissal" ADD CONSTRAINT "save_suggestion_dismissal_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
