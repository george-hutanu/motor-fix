-- When the driver was told of a garage's decline, once the undo window closed.
ALTER TABLE "request_recipient" ADD COLUMN "decline_told_at" TIMESTAMPTZ(3);

-- The window sweep reads only the declines nobody has told yet.
CREATE INDEX "request_recipient_decline_window" ON "request_recipient" ("declined_at")
  WHERE "status" = 'declined' AND "decline_told_at" IS NULL;
