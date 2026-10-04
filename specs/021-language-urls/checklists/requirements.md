# Specification Quality Checklist: Give each language its own web address

**Created**: 2026-10-04 · **Feature**: [spec.md](../spec.md)

- [x] Every FR is testable and names its observable result (FR-001..FR-009 each map to a test in tasks.md › FR → test)
- [x] No FR depends on data that does not exist yet (garages, mechanics, brands moved to Assumptions as EP-4's)
- [x] Every *(proposed)* brief detail is either built or recorded as a deviation (scenario 2 302 → Assumptions + Clarification 1)
- [x] Success criteria are measurable (counts of addresses, reloads, history entries, noindex signals)
- [x] Edge cases cover blocked storage, unsupported stored value, trailing slash, query string, dashboards
- [x] Scope boundaries stated (data-backed sitemap, caching, confirmation/reset/invite links → later stories)
- [x] Spec Delta names what it modifies (`016-FR-011` → `FR-002`)
- [x] No implementation identifiers in requirements beyond the contract names the brief fixes (`mf.lang`, `X-Robots-Tag`, `hreflang`)
- [x] Clarifications recorded with their source (spec-challenger #1–#6)
