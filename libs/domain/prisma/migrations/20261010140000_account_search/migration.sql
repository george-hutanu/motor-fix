-- The admin's account search: contained-text matches on the name, the
-- e-mail and the phone, kept off a sequential scan by trigram indexes.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Lower case, the Romanian diacritics (comma and cedilla forms) read as their
-- base letters. Applied to the stored text and to the query alike.
CREATE FUNCTION account_fold(text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN lower(translate($1, 'ȘșŞşȚțŢţĂăÂâÎî', 'SsSsTtTtAaAaIi'));

CREATE INDEX "account_name_fold_trgm_idx" ON "account" USING GIN (account_fold("name") gin_trgm_ops);
CREATE INDEX "account_email_trgm_idx" ON "account" USING GIN ("email" gin_trgm_ops);
CREATE INDEX "account_phone_trgm_idx" ON "account" USING GIN ("phone" gin_trgm_ops);
