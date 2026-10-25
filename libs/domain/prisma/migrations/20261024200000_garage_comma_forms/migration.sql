-- Romanian text in one form. A garage's name, address, seat and city are
-- kept with the comma-below letters (ș ț), the standard ones: the legacy
-- cedilla letters (ş ţ) are converted on every write, whichever path wrote
-- them, and once here for the rows stored before. One to one, so a value's
-- length never changes; a decomposed cedilla is left as it is.

-- The Romanian marks read as their base letters, case kept: the one map,
-- which the account search's fold now reads too (same values, so its index
-- stays valid).
CREATE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN translate(normalize($1, NFC), 'ȘșŞşȚțŢţĂăÂâÎî', 'SsSsTtTtAaAaIi');

CREATE OR REPLACE FUNCTION account_fold(text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN lower(f_unaccent($1));

CREATE FUNCTION ro_comma_forms(text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN translate($1, 'ŞşŢţ', 'ȘșȚț');

CREATE FUNCTION "garage_comma_forms"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."name" := ro_comma_forms(NEW."name");
  NEW."address" := ro_comma_forms(NEW."address");
  NEW."seat_address" := ro_comma_forms(NEW."seat_address");
  NEW."city_name" := ro_comma_forms(NEW."city_name");
  RETURN NEW;
END;
$$;

CREATE TRIGGER "garage_comma_forms"
  BEFORE INSERT OR UPDATE OF "name", "address", "seat_address", "city_name" ON "garage"
  FOR EACH ROW EXECUTE FUNCTION "garage_comma_forms"();

UPDATE "garage"
SET "name" = ro_comma_forms("name"),
  "address" = ro_comma_forms("address"),
  "seat_address" = ro_comma_forms("seat_address"),
  "city_name" = ro_comma_forms("city_name")
WHERE "name" IS DISTINCT FROM ro_comma_forms("name")
  OR "address" IS DISTINCT FROM ro_comma_forms("address")
  OR "seat_address" IS DISTINCT FROM ro_comma_forms("seat_address")
  OR "city_name" IS DISTINCT FROM ro_comma_forms("city_name");
