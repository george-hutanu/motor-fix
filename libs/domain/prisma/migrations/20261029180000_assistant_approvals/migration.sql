CREATE TYPE "assistant_approval_kind" AS ENUM ('book', 'move', 'cancel');

CREATE TYPE "assistant_approval_status" AS ENUM ('pending', 'approved', 'refused', 'expired', 'failed');

-- An acting tool's call the person approves in the app after the yes.
CREATE TABLE "assistant_approval" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "grant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "tool" TEXT NOT NULL,
    "kind" "assistant_approval_kind" NOT NULL,
    "summary" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "editable" TEXT[],
    "status" "assistant_approval_status" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "outcome" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(3),

    CONSTRAINT "assistant_approval_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "assistant_approval_account_id_status_idx" ON "assistant_approval"("account_id", "status");
CREATE INDEX "assistant_approval_grant_id_status_idx" ON "assistant_approval"("grant_id", "status");
CREATE INDEX "assistant_approval_status_expires_at_idx" ON "assistant_approval"("status", "expires_at");

ALTER TABLE "assistant_approval" ADD CONSTRAINT "assistant_approval_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "assistant_grant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assistant_approval" ADD CONSTRAINT "assistant_approval_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
