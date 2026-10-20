-- The order of the brand-first garage list (rating high to low with the
-- unrated last, more reviews first, then name and id) over the approved
-- garages, so a page with no area reads it instead of sorting every garage.
CREATE INDEX "garage_list_order_idx" ON "garage" ("rating" DESC NULLS LAST, "review_count" DESC, "name", "id") WHERE "status" = 'approved';
