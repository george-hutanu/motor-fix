-- A job tick is inserted only on a brand the garage works on: any writer
-- inserting one on a refused brand is refused here. Turning a brand refused
-- is not checked by this trigger; the brands write (writeGarageBrands) deletes
-- that brand's ticks in the same transaction. A tick with no garage_brand row
-- is left to the composite foreign key, which refuses it after this trigger.
CREATE FUNCTION "garage_brand_job_taken"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "garage_brand"
    WHERE "garage_id" = NEW."garage_id" AND "brand_id" = NEW."brand_id"
      AND "stance" <> 'works_on'
  ) THEN
    RAISE EXCEPTION 'garage_brand_job_taken: brand % is not taken by garage %', NEW."brand_id", NEW."garage_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "garage_brand_job_taken"
BEFORE INSERT ON "garage_brand_job"
FOR EACH ROW EXECUTE FUNCTION "garage_brand_job_taken"();
