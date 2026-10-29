ALTER TYPE "live_stop_reason" ADD VALUE 'sender';
ALTER TABLE "live_session"
  ADD COLUMN "keep_recording" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "recording_media_id" UUID;
CREATE UNIQUE INDEX "live_session_recording_media_id_key" ON "live_session"("recording_media_id");
ALTER TABLE "live_session" ADD CONSTRAINT "live_session_recording_media_id_fkey"
  FOREIGN KEY ("recording_media_id") REFERENCES "media_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
