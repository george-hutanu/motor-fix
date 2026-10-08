-- CreateEnum
CREATE TYPE "platform_rule_change_status" AS ENUM ('requested', 'approved', 'refused', 'cancelled');

-- CreateTable
CREATE TABLE "platform_rule_change" (
    "id" UUID NOT NULL,
    "rule_key" TEXT NOT NULL,
    "old_value" JSONB NOT NULL,
    "new_value" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "platform_rule_change_status" NOT NULL DEFAULT 'requested',
    "requested_by" UUID NOT NULL,
    "requested_by_name" TEXT NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" UUID,
    "decided_by_name" TEXT,
    "decided_at" TIMESTAMPTZ(3),

    CONSTRAINT "platform_rule_change_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_rule_change_rule_key_requested_at_idx" ON "platform_rule_change"("rule_key", "requested_at" DESC);

-- One waiting request per rule; Prisma cannot declare a partial index.
CREATE UNIQUE INDEX "platform_rule_change_one_waiting" ON "platform_rule_change"("rule_key") WHERE "status" = 'requested';
