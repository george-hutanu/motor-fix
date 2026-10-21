-- Prisma's schema cannot express an expression index. The expression is the
-- one ListingDraftsService.cuiHeldElsewhere compares, character for
-- character, so the planner can use it.
CREATE INDEX "listing_draft_cui_idx" ON "listing_draft"
  ((regexp_replace(regexp_replace(data #>> '{steps,6,cui}', '[[:space:]]+', '', 'g'), '^ro', '', 'i')))
  WHERE status = 'open';
