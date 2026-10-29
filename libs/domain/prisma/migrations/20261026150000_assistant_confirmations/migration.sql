-- The person's own "the assistant may act" switch, on for every account.
ALTER TABLE "account" ADD COLUMN "assistant_can_act" BOOLEAN NOT NULL DEFAULT true;

CREATE TYPE "assistant_confirmation_status" AS ENUM ('waiting', 'done', 'failed', 'refused', 'expired', 'void');

-- An acting tool's call waiting for the person's yes.
CREATE TABLE "assistant_confirmation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "grant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "tool" TEXT NOT NULL,
    "args_hash" TEXT NOT NULL,
    "status" "assistant_confirmation_status" NOT NULL DEFAULT 'waiting',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "outcome" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(3),

    CONSTRAINT "assistant_confirmation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "assistant_confirmation_grant_id_status_idx" ON "assistant_confirmation"("grant_id", "status");
CREATE INDEX "assistant_confirmation_account_id_status_idx" ON "assistant_confirmation"("account_id", "status");

ALTER TABLE "assistant_confirmation" ADD CONSTRAINT "assistant_confirmation_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "assistant_grant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assistant_confirmation" ADD CONSTRAINT "assistant_confirmation_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
