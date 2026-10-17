-- The company's fiscal code (CUI), 2 to 10 digits without the RO prefix; the
-- admin reads it in the verification file. Never in a public read.
ALTER TABLE "garage" ADD COLUMN "cui" VARCHAR(10);
ALTER TABLE "garage" ADD CONSTRAINT "garage_cui_digits" CHECK ("cui" ~ '^\d{2,10}$');
