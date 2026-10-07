-- CreateTable
CREATE TABLE "platform_rule" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "default_value" JSONB NOT NULL,
    "requires_two_admins" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3),

    CONSTRAINT "platform_rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_rule_key_key" ON "platform_rule"("key");

-- The rules every environment holds, production included; the seed adds the
-- test-only ones elsewhere.
INSERT INTO "platform_rule" ("id", "key", "value", "default_value", "requires_two_admins")
VALUES
    (gen_random_uuid(), 'reviews_only_after_confirmed_job', 'true', 'true', true),
    (gen_random_uuid(), 'maintenance_mode', 'false', 'false', false);
