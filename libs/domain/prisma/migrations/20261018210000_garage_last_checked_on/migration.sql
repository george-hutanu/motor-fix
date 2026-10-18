-- The day of the garage's latest approval.
ALTER TABLE "garage" ADD COLUMN "last_checked_on" DATE;

-- The file read names the other garages holding the same CUI.
CREATE INDEX "garage_cui_idx" ON "garage"("cui");
