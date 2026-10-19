-- ST-1190: the live stream's cursor and the bell's stored unread count.

-- Existing rows are numbered in creation order, then the sequence carries on.
ALTER TABLE "notification" ADD COLUMN "position" BIGINT;

UPDATE "notification" AS n
SET "position" = numbered.rn
FROM (
  SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS rn
  FROM "notification"
) AS numbered
WHERE n."id" = numbered."id";

CREATE SEQUENCE "notification_position_seq" OWNED BY "notification"."position";
SELECT setval('"notification_position_seq"', COALESCE((SELECT max("position") FROM "notification"), 0) + 1, false);

ALTER TABLE "notification"
  ALTER COLUMN "position" SET DEFAULT nextval('"notification_position_seq"'),
  ALTER COLUMN "position" SET NOT NULL;

CREATE INDEX "notification_account_id_position_idx" ON "notification"("account_id", "position");

-- Every unread in-app row counts, however old.
ALTER TABLE "account" ADD COLUMN "unread_count" INTEGER NOT NULL DEFAULT 0;

UPDATE "account" AS a
SET "unread_count" = counted.n
FROM (
  SELECT "account_id", count(*)::int AS n
  FROM "notification"
  WHERE "channel" = 'in_app' AND "read_at" IS NULL AND "account_id" IS NOT NULL
  GROUP BY "account_id"
) AS counted
WHERE a."id" = counted."account_id";
