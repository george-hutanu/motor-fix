-- An invite can name the card it was sent for, and go to a phone instead of an e-mail.
ALTER TABLE "staff_invite" ADD COLUMN "mechanic_id" UUID;
ALTER TABLE "staff_invite" ADD COLUMN "phone" TEXT;
ALTER TABLE "staff_invite" ALTER COLUMN "email" DROP NOT NULL;

ALTER TABLE "staff_invite" ADD CONSTRAINT "staff_invite_one_address"
    CHECK (("email" IS NULL) <> ("phone" IS NULL));
ALTER TABLE "staff_invite" ADD CONSTRAINT "staff_invite_phone_length"
    CHECK (char_length("phone") <= 20);

CREATE INDEX "staff_invite_mechanic_id_idx" ON "staff_invite"("mechanic_id");

ALTER TABLE "staff_invite" ADD CONSTRAINT "staff_invite_mechanic_id_fkey" FOREIGN KEY ("mechanic_id") REFERENCES "mechanic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
