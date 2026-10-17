-- The time of the latest sending; a file already there was sent when it was created.
ALTER TABLE "verification_file" ADD COLUMN "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "verification_file" SET "submitted_at" = "created_at";

-- The admins' queue: the files waiting, oldest sending first.
CREATE INDEX "verification_file_status_submitted_at_idx" ON "verification_file"("status", "submitted_at");
