-- The garage's RAR authorisation number on its verification file (ST-204).
ALTER TABLE "verification_file" ADD COLUMN "rar_number" VARCHAR(40);
