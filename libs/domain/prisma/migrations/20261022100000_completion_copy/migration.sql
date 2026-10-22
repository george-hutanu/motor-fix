-- AlterTable
ALTER TABLE "listing_draft" ADD COLUMN "verification_file_id" UUID;

-- AlterTable
ALTER TABLE "legal_document" ADD COLUMN "replaced_at" TIMESTAMPTZ(3);

-- DropIndex
DROP INDEX "legal_document_verification_file_id_kind_key";

-- CreateIndex
CREATE INDEX "listing_draft_verification_file_id_idx" ON "listing_draft"("verification_file_id");

-- One open completion copy per file; one current document per kind.
CREATE UNIQUE INDEX "listing_draft_one_open_copy" ON "listing_draft"("verification_file_id") WHERE "status" = 'open' AND "verification_file_id" IS NOT NULL;
CREATE UNIQUE INDEX "legal_document_one_current" ON "legal_document"("verification_file_id", "kind") WHERE "replaced_at" IS NULL;

-- AddForeignKey
ALTER TABLE "listing_draft" ADD CONSTRAINT "listing_draft_verification_file_id_fkey" FOREIGN KEY ("verification_file_id") REFERENCES "verification_file"("id") ON DELETE CASCADE ON UPDATE CASCADE;
