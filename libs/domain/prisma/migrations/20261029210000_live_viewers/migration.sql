ALTER TABLE "live_session"
  ADD COLUMN "viewed_by_driver_at" TIMESTAMPTZ(3),
  ADD COLUMN "peak_viewers" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "live_viewer" (
  "live_session_id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "first_viewed_at" TIMESTAMPTZ(3) NOT NULL,
  "last_viewed_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "live_viewer_pkey" PRIMARY KEY ("live_session_id", "account_id")
);
CREATE INDEX "live_viewer_account_id_idx" ON "live_viewer"("account_id");
ALTER TABLE "live_viewer" ADD CONSTRAINT "live_viewer_live_session_id_fkey"
  FOREIGN KEY ("live_session_id") REFERENCES "live_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "live_viewer" ADD CONSTRAINT "live_viewer_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
