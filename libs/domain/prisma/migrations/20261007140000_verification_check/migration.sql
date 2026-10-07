-- CreateEnum
CREATE TYPE "verification_check_kind" AS ENUM ('company', 'caen', 'rar', 'activities', 'representative', 'address', 'photos', 'documents');

-- CreateEnum
CREATE TYPE "verification_check_result" AS ENUM ('not_run', 'ok', 'warning', 'failed');

-- AlterTable
ALTER TABLE "garage" ADD COLUMN "rar_activities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "verification_check" (
    "id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "kind" "verification_check_kind" NOT NULL,
    "automatic" BOOLEAN NOT NULL DEFAULT false,
    "result" "verification_check_result" NOT NULL DEFAULT 'not_run',
    "detail" TEXT,
    "recorded_by" UUID,
    "recorded_at" TIMESTAMPTZ(3),

    CONSTRAINT "verification_check_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "verification_check_detail_length" CHECK (char_length("detail") <= 200)
);

-- CreateTable
CREATE TABLE "rar_activity" (
    "code" TEXT NOT NULL,
    "name_ro" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,

    CONSTRAINT "rar_activity_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE UNIQUE INDEX "verification_check_file_id_kind_key" ON "verification_check"("file_id", "kind");

-- AddForeignKey
ALTER TABLE "verification_check" ADD CONSTRAINT "verification_check_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "verification_file"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The activities named on the feature page, until the lawyer confirms the list.
INSERT INTO "rar_activity" ("code", "name_ro", "name_en") VALUES
    ('mechanics', 'Mecanică', 'Mechanics'),
    ('brakes', 'Frâne', 'Brakes'),
    ('steering', 'Direcție', 'Steering'),
    ('suspension', 'Suspensie', 'Suspension'),
    ('air_con', 'Aer condiționat', 'Air conditioning');

-- Files sent before the checks existed get theirs, none run.
INSERT INTO "verification_check" ("id", "file_id", "kind")
SELECT gen_random_uuid(), f."id", k."kind"
FROM "verification_file" f
CROSS JOIN unnest(enum_range(NULL::"verification_check_kind")) AS k("kind");
