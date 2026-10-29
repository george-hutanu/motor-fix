-- A person's dashboard sections for one role, in their order; no garage.
CREATE TABLE "dashboard_layout" (
    "account_id" UUID NOT NULL,
    "role" "role" NOT NULL,
    "panels" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "dashboard_layout_pkey" PRIMARY KEY ("account_id","role")
);

ALTER TABLE "dashboard_layout" ADD CONSTRAINT "dashboard_layout_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
