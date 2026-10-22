-- CreateTable
CREATE TABLE "copy_voice_setting" (
    "id" UUID NOT NULL,
    "voice" SMALLINT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3),

    CONSTRAINT "copy_voice_setting_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "copy_voice_setting_voice_check" CHECK ("voice" BETWEEN 1 AND 5)
);

-- CreateIndex
CREATE UNIQUE INDEX "copy_voice_setting_voice_key" ON "copy_voice_setting"("voice");

-- The five voices every environment holds: all on, none pinned.
INSERT INTO "copy_voice_setting" ("id", "voice")
SELECT gen_random_uuid(), v FROM generate_series(1, 5) AS v;
