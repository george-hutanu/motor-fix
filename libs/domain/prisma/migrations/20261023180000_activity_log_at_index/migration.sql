-- The admin's unfiltered history and its count read the last seven days of
-- every garage: an index on the time alone, beside the four scoped ones.
CREATE INDEX "activity_log_at_idx" ON "activity_log"("at");
