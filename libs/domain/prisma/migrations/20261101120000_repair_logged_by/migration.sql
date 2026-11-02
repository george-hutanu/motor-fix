-- AlterTable
ALTER TABLE "repair" ADD COLUMN "logged_by" UUID;

-- AddForeignKey
ALTER TABLE "repair" ADD CONSTRAINT "repair_logged_by_fkey" FOREIGN KEY ("logged_by") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
