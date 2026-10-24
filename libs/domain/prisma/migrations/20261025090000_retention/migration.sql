-- When the garage closed; NULL while it is open. Closing and reopening a
-- garage set and clear it; the retention job reads it.
ALTER TABLE "garage" ADD COLUMN "closed_at" TIMESTAMPTZ(3);

-- The audit history stays append-only for every database user, the table
-- owner included, with one exception: the retention job's anonymising write,
-- which blanks the actor and the values and leaves every other column as it
-- was. Delete and truncate stay refused.
DROP TRIGGER "activity_log_append_only" ON "activity_log";

CREATE TRIGGER "activity_log_refuse_delete"
    BEFORE DELETE ON "activity_log"
    FOR EACH ROW EXECUTE FUNCTION "activity_log_refuse"();

CREATE FUNCTION "activity_log_anonymise"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    anonymised "activity_log"%ROWTYPE := OLD;
BEGIN
    anonymised.actor_id := NULL;
    anonymised.actor_name := 'anonymised';
    anonymised.old_value := NULL;
    anonymised.new_value := NULL;
    anonymised.text := NULL;
    IF NEW IS DISTINCT FROM anonymised THEN
        RAISE EXCEPTION 'activity_log is append-only';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "activity_log_anonymise_only"
    BEFORE UPDATE ON "activity_log"
    FOR EACH ROW EXECUTE FUNCTION "activity_log_anonymise"();
