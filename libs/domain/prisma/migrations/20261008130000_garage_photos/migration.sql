-- The gallery of a sent listing: one row per photo, in the owner's order.
CREATE TABLE "garage_photo" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "garage_id" UUID NOT NULL,
    "file_key" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "garage_photo_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "garage_photo_position_from_zero" CHECK ("position" >= 0),
    CONSTRAINT "garage_photo_width_positive" CHECK ("width" > 0),
    CONSTRAINT "garage_photo_height_positive" CHECK ("height" > 0)
);

CREATE UNIQUE INDEX "garage_photo_file_key_key" ON "garage_photo"("file_key");
CREATE UNIQUE INDEX "garage_photo_garage_id_position_key" ON "garage_photo"("garage_id", "position");

ALTER TABLE "garage_photo" ADD CONSTRAINT "garage_photo_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
