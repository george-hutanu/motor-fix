-- What the admin found when recording a register check: the company name for
-- `company`, the three ticks and the certificate's presence for `caen`, and the
-- day of the look-up. Null for the other kinds.
ALTER TABLE "verification_check" ADD COLUMN "evidence" JSONB;
