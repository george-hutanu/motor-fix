-- AlterTable
ALTER TABLE "garage" ADD COLUMN "facilities_note" TEXT;

-- Blank as JavaScript's trim() sees it, Unicode spaces included.
ALTER TABLE "garage" ADD CONSTRAINT "garage_facilities_note_check" CHECK ("facilities_note" IS NULL OR (char_length("facilities_note") <= 200 AND "facilities_note" !~ '^[\s   -     　﻿]*$'));
