-- The log's search compares account_fold(message), which a trigram index on
-- the raw message cannot serve: the index is on the folded text instead.
DROP INDEX "system_log_entry_message_trgm_idx";

CREATE INDEX "system_log_entry_message_fold_trgm_idx" ON "system_log_entry" USING GIN (account_fold("message") gin_trgm_ops);
