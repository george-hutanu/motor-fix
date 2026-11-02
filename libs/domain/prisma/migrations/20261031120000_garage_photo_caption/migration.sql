-- AlterTable
ALTER TABLE "garage_photo" ADD COLUMN "caption" VARCHAR(80);

ALTER TABLE "garage_photo" ADD CONSTRAINT "garage_photo_caption_length" CHECK ("caption" IS NULL OR (char_length("caption") BETWEEN 1 AND 80 AND "caption" !~ '[[:cntrl:]]'));
