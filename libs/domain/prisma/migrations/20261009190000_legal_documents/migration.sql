-- AlterTable
ALTER TABLE "verification_file" ADD COLUMN "declared_at" TIMESTAMPTZ(3),
ADD COLUMN "declared_by_name" TEXT;

-- CreateTable
CREATE TABLE "legal_document" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "verification_file_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "pages" TEXT[],
    "issued_on" DATE,
    "status" TEXT NOT NULL DEFAULT 'valid',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_document_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "legal_document_pages_check" CHECK (cardinality("pages") BETWEEN 1 AND 10)
);

-- CreateIndex
CREATE INDEX "legal_document_verification_file_id_idx" ON "legal_document"("verification_file_id");

-- CreateIndex
CREATE UNIQUE INDEX "legal_document_verification_file_id_kind_key" ON "legal_document"("verification_file_id", "kind");

-- AddForeignKey
ALTER TABLE "legal_document" ADD CONSTRAINT "legal_document_verification_file_id_fkey" FOREIGN KEY ("verification_file_id") REFERENCES "verification_file"("id") ON DELETE CASCADE ON UPDATE CASCADE;
