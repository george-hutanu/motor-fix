-- A stored consent choice is never changed: a new choice is a new row. Rows
-- go only with their account, whose erasure cascades to them.
CREATE FUNCTION "consent_record_refuse_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'consent_record rows are never changed';
END;
$$;

CREATE TRIGGER "consent_record_no_update"
    BEFORE UPDATE ON "consent_record"
    FOR EACH ROW EXECUTE FUNCTION "consent_record_refuse_update"();
