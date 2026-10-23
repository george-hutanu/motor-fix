-- AlterTable: the admin's decision on a yearly upload.
ALTER TABLE "legal_document" ADD COLUMN "decided_at" TIMESTAMPTZ(3),
ADD COLUMN "decided_by" UUID,
ADD COLUMN "refusal_note" TEXT,
ADD COLUMN "refusal_reason" TEXT,
ADD CONSTRAINT "legal_document_status_check" CHECK ("status" IN ('valid', 'in_review', 'refused')),
ADD CONSTRAINT "legal_document_refusal_reason_check" CHECK ("refusal_reason" IN ('documents', 'other'));

-- One current valid document and at most one in review, per file and kind.
DROP INDEX "legal_document_one_current";
CREATE UNIQUE INDEX "legal_document_one_valid" ON "legal_document"("verification_file_id", "kind") WHERE "replaced_at" IS NULL AND "status" = 'valid';
CREATE UNIQUE INDEX "legal_document_one_in_review" ON "legal_document"("verification_file_id", "kind") WHERE "status" = 'in_review';

-- CreateIndex
CREATE INDEX "legal_document_status_created_at_idx" ON "legal_document"("status", "created_at");

-- CreateTable
CREATE TABLE "garage_document_cycle" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "garage_id" UUID NOT NULL,
    "due_on" DATE NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'due',
    "grace_until" DATE,
    "reminded_30_at" TIMESTAMPTZ(3),
    "reminded_7_at" TIMESTAMPTZ(3),
    "reminded_0_at" TIMESTAMPTZ(3),
    "reset_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "garage_document_cycle_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "garage_document_cycle_state_check" CHECK ("state" IN ('due', 'overdue'))
);

-- CreateIndex
CREATE UNIQUE INDEX "garage_document_cycle_garage_id_key" ON "garage_document_cycle"("garage_id");

-- CreateIndex
CREATE INDEX "garage_document_cycle_state_due_on_idx" ON "garage_document_cycle"("state", "due_on");

-- AddForeignKey
ALTER TABLE "garage_document_cycle" ADD CONSTRAINT "garage_document_cycle_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every garage already on the map, or taken off it, owes its documents a
-- year after its approval, and never sooner than in 30 days, so each owner
-- gets the whole reminder sequence. Days are Bucharest days; a 29 February
-- plus 12 months is 28 February.
INSERT INTO "garage_document_cycle" ("garage_id", "due_on")
SELECT "id", GREATEST(
    (("approved_at" AT TIME ZONE 'Europe/Bucharest')::date + INTERVAL '12 months')::date,
    (now() AT TIME ZONE 'Europe/Bucharest')::date + 30
)
FROM "garage"
WHERE "status" IN ('approved', 'suspended') AND "approved_at" IS NOT NULL
ON CONFLICT ("garage_id") DO NOTHING;
