-- The admin dashboard's six service tiles and their last confirmed state.
CREATE TYPE "status_tile_key" AS ENUM ('api', 'search', 'maps', 'email', 'notifications', 'backup');

CREATE TYPE "status_tile_state" AS ENUM ('green', 'amber', 'red');

CREATE TABLE "status_tile" (
    "key" "status_tile_key" NOT NULL,
    "state" "status_tile_state" NOT NULL,
    "since" TIMESTAMPTZ(3) NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "checked_at" TIMESTAMPTZ(3) NOT NULL,
    "pending_state" "status_tile_state",
    "pending_since" TIMESTAMPTZ(3),

    CONSTRAINT "status_tile_pkey" PRIMARY KEY ("key")
);
