# Deferred findings — 043-brand-first-garage-list

- [ ] No index on `garage(name)`: the brand-first list orders and pages by name then id, and each page request reads both groups and counts them over every approved garage. Fine at today's garage count; add `@@index([status, name, id])` (or the shape the search queries then need) with the search story that grows the list (ST-328). Source: code-reviewer, LOW. `libs/domain/prisma/schema/garages.prisma` (`model Garage`), `libs/domain/src/search/garage-search.service.ts` (`read`).
